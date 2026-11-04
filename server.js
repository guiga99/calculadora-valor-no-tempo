import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculate, indicators, validate, monthRange } from './lib/calculator.js';
import { currencies, exchange, series, latestMonth } from './lib/data.js';

export async function simulate(raw) {
  const input=validate(raw);
  const currencyData=await currencies(), allowed=new Set(currencyData.currencies.map(c=>c.code));
  if(!allowed.has(input.currency)||!allowed.has(input.outputCurrency)) throw Error('Moeda não disponível no catálogo oficial.');
  const now=new Date(), current=now.toISOString().slice(0,7);
  const lastClosed=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
  const start=input.start<input.end?input.start:input.end;
  const end=input.start>input.end?input.start:input.end;
  const historicalEnd=end<lastClosed?end:lastClosed;
  const data={},fxData={},errors={},sources=[],warnings=[];
  if(currencyData.stale) warnings.push('Catálogo de moedas em cache desatualizado.');
  // Limita o paralelismo para não sobrecarregar as fontes oficiais.
  for(const id of [...new Set(input.indicators)]) {
    if(indicators[id].series && start<=historicalEnd && input.start!==input.end) {
      try {
        const r=await series(id,start,historicalEnd); data[id]=r.rows;
        sources.push({indicator:id,url:r.source,updatedAt:r.updatedAt,lastObservation:r.rows.at(-1)?.date});
        if(r.stale) warnings.push(`${indicators[id].name}: usando cache defasado por falha na fonte.`);
      } catch(e) { errors[id]=e.message; }
    }
  }
  const required=new Set([input.currency,input.outputCurrency,...(input.indicators.includes('usd')?['USD']:[])]);
  for(const code of required) {
    if(code==='BRL') continue;
    try {
      const fxStart=start>lastClosed?lastClosed:start;
      const r=await exchange(code,fxStart,historicalEnd<fxStart?fxStart:historicalEnd); fxData[code]=r.months;
      sources.push({currency:code,url:r.source,updatedAt:r.updatedAt,lastObservation:Object.values(r.months).at(-1)?.date});
      if(r.stale) warnings.push(`${code}: usando cotações em cache defasado.`);
    } catch(e) {fxData[code]={};warnings.push(`${code}: ${e.message}`);}
  }
  const fxProjected=new Set();
  function fx(code,month) {
    if(code==='BRL') return 1;
    if(month<=lastClosed) {
      const value=fxData[code]?.[month]?.value;
      if(!value) throw Error(`Sem cotação oficial de ${code} para ${month}.`);
      return value;
    }
    if(!input.allowProjection) throw Error(`Cotação de ${code} em ${month} exige cenário explícito.`);
    const anchor=fxData[code]?.[lastClosed]?.value, target=input.fxScenarios?.[code];
    if(!anchor || !Number.isFinite(target) || target<=0) throw Error(`Informe a cotação futura de ${code} em reais e confira a disponibilidade do último mês fechado.`);
    fxProjected.add(`${code}:${month}`);
    const total=monthRange(lastClosed,end).length-1, elapsed=monthRange(lastClosed,month).length-1;
    return anchor*(target/anchor)**(elapsed/total);
  }
  const results=[];
  for(const id of [...new Set(input.indicators)]) {
    if(errors[id]) {results.push({id,name:indicators[id].name,error:errors[id]});continue;}
    try { const r=calculate(input,id,data,fx,lastClosed);r.points.forEach(p=>{if([...required].some(c=>fxProjected.has(`${c}:${p.month}`)))p.projected=true;});r.projected=r.points.some(p=>p.projected);results.push(r); }
    catch(e){results.push({id,name:indicators[id].name,error:e.message});}
  }
  if(end>=current && input.allowProjection) warnings.push('Cenários futuros e meses ainda não encerrados usam hipóteses informadas, não previsões oficiais.');
  return {input,results,sources,warnings:[...new Set(warnings)],lastClosedMonth:lastClosed,calculatedAt:now.toISOString()};
}
const publicDir=fileURLToPath(new URL('./public/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
export const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'");
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
      if(req.method==='GET' && url.pathname==='/api/meta') {
        const [cs,latest]=await Promise.all([currencies(),latestMonth()]);res.end(JSON.stringify({...cs,latest}));return;
      }
      if(req.method==='POST' && url.pathname==='/api/simulate') {
        let body='';for await (const chunk of req) {body+=chunk;if(body.length>16384){res.writeHead(413);res.end(JSON.stringify({error:'Solicitação muito grande.'}));return;}}
        res.end(JSON.stringify(await simulate(JSON.parse(body))));return;
      }
      res.writeHead(404);res.end(JSON.stringify({error:'Rota não encontrada.'}));return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const path=resolve(publicDir,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(publicDir)){res.writeHead(403);res.end();return;}
    const content=await readFile(path);res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(req.method==='HEAD'?undefined:content);
  } catch(e){res.statusCode=e.code==='ENOENT'?404:400;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({error:e.code==='ENOENT'?'Arquivo não encontrado.':e.message}));}
});
if(process.argv[1]===fileURLToPath(import.meta.url)) server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log(`Calculadora disponível na porta ${process.env.PORT||3000}`));
