import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, rateFactor, validate, annualFactor, monthRange } from '../lib/calculator.js';
import { normalizeSGS, cached } from '../lib/data.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base={amount:100,start:'2020-01',end:'2020-03',currency:'BRL',outputCurrency:'BRL',indicators:['ipca'],cdiPercent:100,fixedRate:12,realRate:6,allowProjection:false,scenarios:{}};
const fx=(code)=>code==='USD'?5:1;
const rows=[{month:'2020-02',value:10},{month:'2020-03',value:20}];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('compõe inflação e exclui o mês de origem',()=>{
  const r=calculate(base,'ipca',{ipca:rows},fx,'2020-03');near(r.final,132);near(r.change,.32);assert.equal(r.points.length,3);
});
test('cálculo inverso divide pelo mesmo fator',()=>{
  const r=calculate({...base,amount:132,start:'2020-03',end:'2020-01'},'ipca',{ipca:rows},fx,'2020-03');near(r.final,100);assert.equal(r.points[0].month,'2020-03');
});
test('meses iguais preservam valor e permitem câmbio',()=>{
  near(calculate({...base,end:base.start},'ipca',{},fx,'2020-03').final,100);
  near(calculate({...base,end:base.start,outputCurrency:'USD'},'ipca',{},fx,'2020-03').final,20);
});
test('CDI percentual é aplicado à taxa diária, antes da composição',()=>{
  const daily=[{month:'2020-02',value:1},{month:'2020-02',value:2}];near(rateFactor(daily,'2020-02','cdi',110),1.011*1.022);
});
test('deflação reduz o valor corrigido',()=>{
  near(calculate({...base,end:'2020-02'},'ipca',{ipca:[{month:'2020-02',value:-1}]},fx,'2020-03').final,99);
});
test('não inventa índices ausentes',()=>assert.throws(()=>calculate(base,'ipca',{ipca:[]},fx,'2020-03'),/Sem dado oficial/));
test('projeção é explícita e usa taxa anual equivalente',()=>{
  const input={...base,allowProjection:true,scenarios:{ipca:12}};
  const r=calculate(input,'ipca',{ipca:[]},fx,'2020-01');near(r.final,100*1.12**(2/12));assert.equal(r.projected,true);
});
test('projeção de CDI considera o percentual escolhido',()=>{
  const r=calculate({...base,end:'2020-02',allowProjection:true,cdiPercent:110,scenarios:{cdi:12}},'cdi',{},fx,'2020-01');near(r.final,100*(1+(1.12**(1/252)-1)*1.1)**21);
});
test('IPCA mais juros compõe a taxa real com a inflação',()=>{
  const r=calculate(base,'ipcaPlus',{ipcaPlus:rows},fx,'2020-03');near(r.final,132*1.06**(2/12));
});
test('mantém a quantidade de dólares e converte o resultado',()=>{
  const rates={'2020-01':4,'2020-02':5,'2020-03':6};const f=(c,m)=>c==='BRL'?1:rates[m];
  near(calculate(base,'usd',{},f,'2020-03').final,150);
  near(calculate({...base,outputCurrency:'USD'},'usd',{},f,'2020-03').final,25);
});
test('conversão entre duas moedas passa pelo real',()=>{
  const f=(c)=>({BRL:1,USD:5,EUR:6}[c]);near(calculate({...base,currency:'USD',outputCurrency:'EUR'},'ipca',{ipca:rows},f,'2020-03').final,110);
});
test('taxa inválida, data inválida e indicador desconhecido são recusados',()=>{
  assert.throws(()=>annualFactor(-100));assert.throws(()=>validate({...base,start:'2020-13'}));assert.throws(()=>validate({...base,indicators:['__proto__']}));assert.throws(()=>validate({...base,amount:-1}));
});
test('poupança usa apenas aniversário no dia 1 e desloca para o fim do período',()=>{
  const normalized=normalizeSGS([{data:'01/12/2020',valor:'0.5'},{data:'02/12/2020',valor:'0.6'}],'savings');assert.deepEqual(normalized,[{date:'2020-12-01',month:'2021-01',value:.5}]);
});
test('normalização ordena, remove duplicados e rejeita conflitos',()=>{
  const normalized=normalizeSGS([{data:'01/02/2020',valor:'2'},{data:'01/01/2020',valor:'1'},{data:'01/02/2020',valor:'2'}],'ipca');assert.equal(normalized.length,2);assert.equal(normalized[0].month,'2020-01');assert.throws(()=>normalizeSGS([{data:'01/01/2020',valor:'1'},{data:'01/01/2020',valor:'2'}],'ipca'));
});
test('intervalo de meses atravessa o ano',()=>assert.deepEqual(monthRange('2020-12','2021-02'),['2020-12','2021-01','2021-02']));
test('cache persiste respostas, evita nova consulta e recupera falha com aviso',async()=>{
  // Processo isolado protege o fetch global e permite controlar o relógio sem afetar os outros testes.
  const {spawnSync}=await import('node:child_process');const dir=await mkdtemp(join(tmpdir(),'valor-cache-'));
  try{
    const script=`import {cached} from './lib/data.js';let calls=0;globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({ok:1})}};const a=await cached('https://example.test/cache');const b=await cached('https://example.test/cache');if(calls!==1||b.stale)throw Error('cache');Date.now=()=>a.savedAt+90000000;globalThis.fetch=async()=>{throw Error('offline')};const c=await cached('https://example.test/cache');if(!c.stale||c.data.ok!==1)throw Error('fallback');`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,CACHE_DIR:dir},encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }finally{await rm(dir,{recursive:true,force:true});}
});
