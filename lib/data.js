import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { indicators, monthRange } from './calculator.js';

const CACHE = process.env.CACHE_DIR || '.cache';
const TTL = 24*60*60*1000;
const pending = new Map();
export const sourceSGS='https://www.bcb.gov.br/estatisticas/indecoreestruturacao';
export const sourceFX='https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/documentacao';
export async function cached(url, check = ()=>true) {
  const key=createHash('sha256').update(url).digest('hex');
  if (pending.has(key)) return pending.get(key);
  const task=(async()=>{
    let prior;
    try { prior=JSON.parse(await readFile(`${CACHE}/${key}.json`,'utf8')); } catch {}
    if (prior && Date.now()-prior.savedAt<TTL && check(prior.data)) return {...prior,stale:false};
    try {
      const res=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{Accept:'application/json'}});
      if (!res.ok) throw Error(`Fonte oficial respondeu HTTP ${res.status}.`);
      const data=await res.json();
      if (!check(data)) throw Error('Resposta inesperada da fonte oficial.');
      const record={data,savedAt:Date.now()};
      await mkdir(CACHE,{recursive:true});
      await writeFile(`${CACHE}/${key}.tmp`,JSON.stringify(record));
      await rename(`${CACHE}/${key}.tmp`,`${CACHE}/${key}.json`);
      return {...record,stale:false};
    } catch(e) {
      if (prior && check(prior.data)) return {...prior,stale:true};
      throw Error(`Consulta oficial indisponível: ${e.message}`);
    }
  })();
  pending.set(key,task);
  try { return await task; } finally { pending.delete(key); }
}
const validSGS = a=>Array.isArray(a)&&a.every(r=>/^\d{2}\/\d{2}\/\d{4}$/.test(r.data)&&Number.isFinite(Number(r.valor)));
const toISO=d=>`${d.slice(6,10)}-${d.slice(3,5)}-${d.slice(0,2)}`;
export function normalizeSGS(rows, id) {
  const unique=new Map();
  for (const r of rows) {
    const date=toISO(r.data);
    if (id==='savings' && date.slice(8)!=='01') continue;
    const next=new Date(`${date.slice(0,7)}-01T12:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
    const month=id==='savings'?next.toISOString().slice(0,7):date.slice(0,7);
    if (unique.has(date) && unique.get(date).value!==Number(r.valor)) throw Error('Fonte retornou observações conflitantes.');
    unique.set(date,{date,month,value:Number(r.valor)});
  }
  return [...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export async function currencies() {
  const url='https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/Moedas?$format=json';
  const r=await cached(url,x=>Array.isArray(x.value)&&x.value.length>0&&x.value.every(m=>/^[A-Z]{3}$/.test(m.simbolo)));
  return {currencies:[{code:'BRL',name:'Real brasileiro'},...r.data.value.map(m=>({code:m.simbolo,name:m.nomeFormatado}))],stale:r.stale,updatedAt:new Date(r.savedAt).toISOString()};
}
function yearRanges(start,end) {
  const out=[];
  for(let y=+start.slice(0,4);y<=+end.slice(0,4);y+=5) out.push([y===+start.slice(0,4)?start:`${y}-01`,Math.min(y+4,+end.slice(0,4))===+end.slice(0,4)?end:`${y+4}-12`]);
  return out;
}
export async function series(id,start,end) {
  const cfg=indicators[id], records=[];
  if(id==='savings') {
    const d=new Date(`${start}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth()-1); start=d.toISOString().slice(0,7);
    if (start<'2012-05') throw Error('Poupança: esta referência cobre períodos iniciados a partir de maio de 2012.');
  }
  // Séries diárias são consultadas em janelas de até cinco anos, abaixo do limite de dez anos.
  for(const [a,b] of yearRanges(start,end)) {
    const last=new Date(+b.slice(0,4),+b.slice(5),0).getDate();
    const url=`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cfg.series}/dados?formato=json&dataInicial=01/${a.slice(5)}/${a.slice(0,4)}&dataFinal=${last}/${b.slice(5)}/${b.slice(0,4)}`;
    records.push(await cached(url,validSGS));
  }
  return {rows:normalizeSGS(records.flatMap(r=>r.data),id), stale:records.some(r=>r.stale), updatedAt:new Date(Math.min(...records.map(r=>r.savedAt))).toISOString(),source:`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cfg.series}/dados?formato=json`};
}
export async function exchange(code,start,end) {
  const records=[];
  for(const [a,b] of yearRanges(start,end)) {
    const last=new Date(+b.slice(0,4),+b.slice(5),0).getDate();
    const root='https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/';
    const url=`${root}CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@ini,dataFinalCotacao=@fim)?@moeda='${code}'&@ini='${a.slice(5)}-01-${a.slice(0,4)}'&@fim='${b.slice(5)}-${last}-${b.slice(0,4)}'&$format=json&$filter=tipoBoletim%20eq%20'Fechamento'&$top=10000`;
    records.push(await cached(url,x=>Array.isArray(x.value)&&!x['@odata.nextLink']&&x.value.every(r=>r.cotacaoVenda>0&&typeof r.dataHoraCotacao==='string')));
  }
  const months={};
  for(const r of records.flatMap(r=>r.data.value).sort((a,b)=>a.dataHoraCotacao.localeCompare(b.dataHoraCotacao))) months[r.dataHoraCotacao.slice(0,7)]={value:r.cotacaoVenda,date:r.dataHoraCotacao.slice(0,10)};
  return {months,stale:records.some(r=>r.stale),updatedAt:new Date(Math.min(...records.map(r=>r.savedAt))).toISOString(),source:sourceFX};
}
export async function latestMonth() {
  const r=await cached('https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1?formato=json',validSGS);
  if(!r.data.length) throw Error('Sem referência recente do IPCA.');
  return {month:toISO(r.data[0].data).slice(0,7),stale:r.stale,updatedAt:new Date(r.savedAt).toISOString()};
}
