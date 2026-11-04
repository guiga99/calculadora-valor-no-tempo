export const indicators = {
  ipca: { name: 'IPCA', kind: 'Inflação', series: 433 },
  inpc: { name: 'INPC', kind: 'Inflação', series: 188 },
  usd: { name: 'Dólar', kind: 'Câmbio' },
  cdi: { name: 'CDI', kind: 'Investimento', series: 12, daily: true },
  selic: { name: 'Selic', kind: 'Investimento', series: 11, daily: true },
  savings: { name: 'Poupança', kind: 'Investimento', series: 195 },
  fixed: { name: 'Taxa fixa', kind: 'Investimento' },
  ipcaPlus: { name: 'IPCA + juros', kind: 'Investimento', series: 433 }
};
export function monthRange(a, b) {
  const out = [];
  for (let n = +a.slice(0,4)*12 + +a.slice(5)-1, end = +b.slice(0,4)*12 + +b.slice(5)-1; n <= end; n++)
    out.push(`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`);
  return out;
}
export function annualFactor(rate) {
  if (!Number.isFinite(rate) || rate <= -100 || rate > 10000) throw Error('Taxa anual deve ser maior que -100% e até 10.000%.');
  return (1+rate/100)**(1/12);
}
export function validate(input, now = new Date()) {
  if(!input || typeof input!=='object') throw Error('Informe os parâmetros da simulação.');
  const month = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!month.test(input.start) || !month.test(input.end)) throw Error('Informe mês e ano válidos.');
  if ([input.start,input.end].some(m => m < '1994-07' || m > '2100-12')) throw Error('Selecione datas entre julho de 1994 e dezembro de 2100.');
  if (input.start > now.toISOString().slice(0,7)) throw Error('O mês inicial deve estar no passado ou no mês atual.');
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e15) throw Error('Informe um valor positivo de até 1 quatrilhão.');
  if (!Array.isArray(input.indicators) || !input.indicators.length || input.indicators.length > 8 || input.indicators.some(id=>!Object.hasOwn(indicators,id))) throw Error('Selecione indicadores válidos.');
  if (!/^[A-Z]{3}$/.test(input.currency) || !/^[A-Z]{3}$/.test(input.outputCurrency)) throw Error('Moeda inválida.');
  if (!Number.isFinite(input.cdiPercent) || input.cdiPercent < 0 || input.cdiPercent > 1000) throw Error('Percentual do CDI deve estar entre 0 e 1.000.');
  annualFactor(input.fixedRate); annualFactor(input.realRate);
  return input;
}
export function rateFactor(rows, month, id, percent = 100) {
  const matches = rows.filter(r=>r.month === month);
  if (!matches.length) throw Error(`Sem dado oficial para ${month}. Ative cenários para informar uma hipótese.`);
  if (indicators[id].daily) return matches.reduce((acc,r)=>acc*(1+r.value/100*(id==='cdi'?percent/100:1)),1);
  // SGS 195: remuneração do período iniciado no dia 1 do mês anterior.
  // A normalização atribui o rendimento ao mês em que esse período termina.
  if (matches.length !== 1) throw Error(`Dados mensais duplicados para ${month}.`);
  return 1+matches[0].value/100;
}
export function calculate(input, id, data, fx, lastClosedMonth) {
  const a = input.start < input.end ? input.start : input.end;
  const b = input.start > input.end ? input.start : input.end;
  const months = monthRange(a,b), factors = new Map([[a,1]]), projected = new Set();
  const isFx = id==='usd';
  for (const m of months.slice(1)) {
    let f;
    if (isFx) f = fx('USD',m) / fx('USD',months[months.indexOf(m)-1]);
    else if (id==='fixed') f=annualFactor(input.fixedRate);
    else {
      const rows = data?.[id] || [];
      if (m > lastClosedMonth || !rows.some(r=>r.month===m)) {
        if (!input.allowProjection) throw Error(`Sem dado oficial completo para ${m}. Ative cenários para projetar.`);
        const key = id==='ipcaPlus'?'ipca':id;
        const rate=input.scenarios?.[key];
        f=annualFactor(rate);
        if(id==='cdi') f=(1+((1+rate/100)**(1/252)-1)*input.cdiPercent/100)**21;
        projected.add(m);
      } else f=rateFactor(rows,m,id,input.cdiPercent);
      if (id==='ipcaPlus') f*=annualFactor(input.realRate);
    }
    if (!Number.isFinite(f) || f<=0) throw Error('Fator de correção inválido.');
    factors.set(m, factors.get(months[months.indexOf(m)-1])*f);
  }
  const initialBRL = input.amount*fx(input.currency,input.start);
  const originFactor = factors.get(input.start);
  const points = months.map(m=>({month:m, brl:initialBRL*factors.get(m)/originFactor,
    value: initialBRL*factors.get(m)/originFactor/fx(input.outputCurrency,m), projected:projected.has(m)}));
  if (input.start>input.end) points.reverse();
  const final=points.at(-1).value;
  if (!points.every(p=>Number.isFinite(p.value))) throw Error('Resultado excede o limite numérico.');
  const initialOutput=initialBRL/fx(input.outputCurrency,input.start);
  return {id,...indicators[id], final, initial:initialOutput, change:final/initialOutput-1, difference:final-initialOutput, points, projected:projected.size>0};
}
