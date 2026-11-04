const $=id=>document.getElementById(id);
const colors={ipca:'#47785b',inpc:'#bb893d',usd:'#527da0',cdi:'#8774a5',selic:'#9a654d',savings:'#78a89c',fixed:'#b36f8e',ipcaPlus:'#69753b'};
const names={ipca:'IPCA',inpc:'INPC',usd:'Dólar',cdi:'CDI',selic:'Selic',savings:'Poupança',fixed:'Taxa fixa',ipcaPlus:'IPCA + juros'};
const descriptions={ipca:'Estimativa para preservar o poder de compra.',inpc:'Correção pelo custo de vida medido pelo INPC.',usd:'Quantidade inicial de dólares mantida no período.',cdi:'Rendimento bruto pelo percentual do CDI escolhido.',selic:'Rendimento pela Selic efetiva, sem preço de título.',savings:'Referência de poupança; aniversário no dia 1.',fixed:'Simulação pela taxa anual definida por você.',ipcaPlus:'Inflação acumulada e juros reais compostos.'};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthLabel=m=>new Date(`${m}-02T12:00:00Z`).toLocaleDateString('pt-BR',{month:'short',year:'numeric',timeZone:'UTC'});
const percent=n=>(n>=0?'+':'')+new Intl.NumberFormat('pt-BR',{style:'percent',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
let latest=null, report=null, busy=false;
const closed=new Date();closed.setUTCDate(1);closed.setUTCMonth(closed.getUTCMonth()-1);$('end').value=closed.toISOString().slice(0,7);
$('start').max=new Date().toISOString().slice(0,7);
for(const [key,rate] of Object.entries({ipca:4.5,inpc:4.5,cdi:10,selic:10,savings:6})) {
  const wrapper=document.createElement('div');wrapper.innerHTML=`<label for="scenario-${key}">${names[key]} (% a.a.)</label><input id="scenario-${key}" type="number" min="-99.99" max="10000" step="0.01" value="${rate}">`;$('rate-scenarios').append(wrapper);
}
function syncScenarios(){
  $('scenario-fields').hidden=!$('allow-projection').checked;
  const selected=new Set([...document.querySelectorAll('[name="indicator"]:checked')].map(x=>x.value));
  for(const key of ['ipca','inpc','cdi','selic','savings']) $('scenario-'+key).parentElement.hidden=!(selected.has(key)||(key==='ipca'&&selected.has('ipcaPlus')));
  const codes=[...new Set([$('currency').value,$('output-currency').value,...(selected.has('usd')?['USD']:[])])].filter(c=>c!=='BRL');
  const previous=Object.fromEntries([...document.querySelectorAll('[data-fx]')].map(x=>[x.dataset.fx,x.value]));
  $('fx-scenarios').replaceChildren();
  for(const code of codes){const div=document.createElement('div');const label=document.createElement('label');label.htmlFor=`fx-${code}`;label.textContent=`Cotação final de 1 ${code} em reais (R$)`;const input=document.createElement('input');input.id=`fx-${code}`;input.dataset.fx=code;input.type='number';input.min='0.000001';input.step='any';input.placeholder='Informe sua hipótese';input.value=previous[code]||'';div.append(label,input);$('fx-scenarios').append(div);}
}
$('allow-projection').addEventListener('change',syncScenarios);
document.querySelectorAll('[name="indicator"],#currency,#output-currency').forEach(el=>el.addEventListener('change',syncScenarios));syncScenarios();
async function request(url,options){const r=await fetch(url,options);let data;try{data=await r.json();}catch{throw Error('O servidor retornou uma resposta inesperada. Tente novamente.');}if(!r.ok)throw Error(data.error||'Não foi possível consultar os dados.');return data;}
async function loadMeta(){
  try{
    const data=await request('/api/meta');latest=data.latest.month;
    const oldStart=$('currency').value,oldOut=$('output-currency').value;
    for(const [id,short] of [['currency',true],['output-currency',false]]){
      $(id).replaceChildren(...data.currencies.map(c=>{const o=document.createElement('option');o.value=c.code;o.textContent=short?c.code:`${c.code} · ${c.name}`;return o;}));
    }
    $('currency').value=oldStart;$('output-currency').value=oldOut;
    $('end').value=latest;
    $('data-status').textContent=`IPCA publicado: ${monthLabel(latest)}${data.latest.stale?' · cache defasado':''}`;
    syncScenarios();
  }catch(e){$('data-status').textContent='Fonte temporariamente indisponível';$('message').textContent=e.message+' Use o botão de último mês para tentar novamente.';}
}
$('latest').addEventListener('click',async()=>{if(!latest)await loadMeta();if(latest)$('end').value=latest;});
function getInput(){
  const text=$('amount').value.trim();
  if(!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(text))throw Error('Informe o valor no formato brasileiro, por exemplo: 15.000,00.');
  const selected=[...document.querySelectorAll('[name="indicator"]:checked')].map(el=>el.value);
  if(!selected.length)throw Error('Selecione ao menos um indicador.');
  const scenarios=Object.fromEntries(['ipca','inpc','cdi','selic','savings'].map(k=>[k,Number($('scenario-'+k).value)]));
  const fxScenarios=Object.fromEntries([...document.querySelectorAll('[data-fx]')].map(x=>[x.dataset.fx,x.value===''?null:Number(x.value)]));
  return {amount:Number(text.replaceAll('.','').replace(',','.')),start:$('start').value,end:$('end').value,currency:$('currency').value,outputCurrency:$('output-currency').value,indicators:selected,cdiPercent:Number($('cdi-percent').value),fixedRate:Number($('fixed-rate').value),realRate:Number($('real-rate').value),allowProjection:$('allow-projection').checked,scenarios,fxScenarios};
}
$('simulation-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  try{
    const input=getInput();busy=true;$('submit').disabled=true;$('submit').textContent='Consultando dados oficiais…';$('message').textContent='Buscando o histórico no Banco Central. A primeira consulta pode levar alguns minutos; as seguintes aproveitam o cache.';
    const data=await request('/api/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});report=data;render(data);
  }catch(error){$('message').textContent=error.message;}
  finally{busy=false;$('submit').disabled=false;$('submit').innerHTML='Calcular valor no tempo <span>↗</span>';}
});
function render(data){
  const valid=data.results.filter(r=>!r.error);
  const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:data.input.outputCurrency}).format(n);
  const warnings=[...data.warnings,...data.results.filter(r=>r.error).map(r=>`${r.name}: ${r.error}`)];
  $('message').replaceChildren(...warnings.map(w=>{const p=document.createElement('p');p.textContent=w;return p;}));
  if(!valid.length){$('result-content').hidden=true;$('empty').hidden=false;$('export').hidden=true;return;}
  $('empty').hidden=true;$('result-content').hidden=false;$('export').hidden=false;
  $('period-description').textContent=`${monthLabel(data.input.start)} → ${monthLabel(data.input.end)} · ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:data.input.currency}).format(data.input.amount)} na origem · resultados em ${data.input.outputCurrency}`;
  $('cards').innerHTML=valid.map(r=>`<article class="result-card" data-indicator="${r.id}"><div class="card-title"><span>${escape(r.name)}</span><span class="kind">${escape(r.kind)}</span></div><strong class="value">${escape(money(r.final))}</strong><span class="change">${escape(percent(r.change))} no período</span><p>${escape(descriptions[r.id])}</p>${r.projected?'<span class="tag">INCLUI CENÁRIO</span>':''}</article>`).join('');
  document.querySelectorAll('[data-indicator]').forEach(el=>el.style.setProperty('--card-color',colors[el.dataset.indicator]));
  $('table-body').innerHTML=valid.map(r=>`<tr><td>${escape(r.name)}</td><td>${escape(money(r.final))}</td><td>${escape(percent(r.change))}</td><td>${escape(money(r.difference))}</td></tr>`).join('');
  $('sources').replaceChildren(...data.sources.map(s=>{const p=document.createElement('p'),a=document.createElement('a');a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=s.currency?`PTAX · ${s.currency}`:`SGS · ${names[s.indicator]}`;p.append(a,` · consultado em ${new Date(s.updatedAt).toLocaleString('pt-BR')}${s.lastObservation?' · observação: '+s.lastObservation:''}`);return p;}));
  const p=document.createElement('p');p.textContent=`Calculado em ${new Date(data.calculatedAt).toLocaleString('pt-BR')}. Datas no fim do mês. Variação medida na moeda de apresentação. Sem IR, taxas ou aportes.`;$('sources').append(p);
  renderChart(valid,data.input.outputCurrency);
}
function renderChart(results,currency){
  const ordered=results.map(r=>({...r,points:[...r.points].sort((a,b)=>a.month.localeCompare(b.month))}));
  const all=ordered.flatMap(r=>r.points.map(p=>p.value));let min=Math.min(...all),max=Math.max(...all);const padding=(max-min)*.12||Math.max(max*.1,1);min-=padding;max+=padding;
  const w=700,h=300,left=75,right=18,top=18,bottom=40;
  const count=ordered[0].points.length,x=i=>left+(w-left-right)*(count===1?.5:i/(count-1)),y=v=>h-bottom-(v-min)/(max-min)*(h-top-bottom);
  const short=new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});
  let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolução mensal dos valores em ${escape(currency)}"><title>Evolução mensal dos valores em ${escape(currency)}. A tabela abaixo apresenta os resultados finais; baixe o CSV para consultar todos os meses.</title>`;
  for(let i=0;i<5;i++){const value=min+(max-min)*i/4,yy=y(value);svg+=`<line x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}" stroke="#e7ebe4"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${escape(short.format(value))}</text>`;}
  for(const i of [...new Set([0,Math.floor((count-1)/2),count-1])])svg+=`<text x="${x(i)}" y="${h-10}" text-anchor="middle">${escape(monthLabel(ordered[0].points[i].month))}</text>`;
  for(const r of ordered){for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i];svg+=`<path d="M${x(i-1)},${y(a.value)} L${x(i)},${y(b.value)}" fill="none" stroke="${colors[r.id]}" stroke-width="2.5"${a.projected||b.projected?' stroke-dasharray="5 4"':''}/>`;}
    r.points.forEach((p,i)=>{svg+=`<circle cx="${x(i)}" cy="${y(p.value)}" r="${count<18?3:1.8}" fill="${colors[r.id]}"><title>${escape(r.name)} · ${escape(monthLabel(p.month))}: ${escape(new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(p.value))}${p.projected?' (cenário)':''}</title></circle>`;});}
  $('chart').innerHTML=svg+'</svg>';
  $('legend').innerHTML=results.map(r=>`<span data-indicator="${r.id}"><i></i>${escape(r.name)}</span>`).join('');$('legend').querySelectorAll('[data-indicator]').forEach(el=>el.style.setProperty('--card-color',colors[el.dataset.indicator]));
}
$('export').addEventListener('click',()=>{
  if(!report)return;const rows=[['indicador','mes','moeda','valor','tipo']];for(const r of report.results.filter(r=>!r.error))for(const p of r.points)rows.push([r.name,p.month,report.input.outputCurrency,p.value.toFixed(2).replace('.',','),p.projected?'cenario':'referencia']);
  const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='valor-no-tempo.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
loadMeta();
