# Valor no Tempo

Calculadora web em português para comparar inflação, câmbio e rendimentos brasileiros entre meses, com dados oficiais atualizados automaticamente, múltiplas moedas e cenários futuros explícitos.

## Executar

Requer **Node.js 24 ou superior**. Não há dependências externas nem chaves de API.

```sh
npm start
```

Abra `http://localhost:3000`. A primeira consulta de um histórico longo pode demorar; as seguintes reutilizam o cache de 24 horas. O servidor precisa de acesso HTTPS a `api.bcb.gov.br` e `olinda.bcb.gov.br`. Proxies de ambiente são respeitados pelo Node.

```sh
npm run check
npm test
```

## Hospedagem

É necessário um servidor Node; GitHub Pages sozinho não executa o backend. Configure comando de inicialização `npm start`, Node 24 e uma pasta persistente de cache. `PORT` configura a porta; `CACHE_DIR` configura a pasta (padrão `.cache`). O processo precisa de permissão para gravar nela.

Há um blueprint `render.yaml` para hospedar como serviço Docker no Render. No plano gratuito, o cache em disco é temporário e será refeito após reinicializações; use um disco persistente em um plano compatível se precisar preservar o cache entre implantações. A publicação depende de conectar sua conta do provedor ao repositório.

Uma imagem Docker também está disponível:

```sh
docker build -t valor-no-tempo .
docker run --rm -p 3000:3000 -v valor-cache:/app/.cache valor-no-tempo
```

Para uma instância pública com tráfego elevado, coloque um proxy com limite de requisições na frente. O servidor não armazena dados pessoais ou simulações; persiste apenas respostas das fontes oficiais.

## Dados e atualização

- [SGS / Banco Central](https://www.bcb.gov.br/estatisticas/indecoreestruturacao): IPCA (433), INPC (188), CDI diário (12), Selic efetiva diária (11) e poupança para depósitos a partir de 04/05/2012 (195).
- [API PTAX](https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/documentacao): catálogo de moedas e fechamento de venda. Além de BRL, as moedas são carregadas do catálogo oficial.
- IPCA e INPC são produzidos pelo IBGE e distribuídos pelo SGS. CDI é uma referência de mercado distribuída pelo SGS.
- O servidor consulta automaticamente as fontes quando os dados solicitados não estão em cache ou passaram de 24 horas. Não exige atualização na conversa, cadastro ou tarefa agendada.
- Requisições históricas são divididas em blocos de até cinco anos. Respostas são validadas e deduplicadas. Falhas temporárias podem usar o cache anterior com aviso e data de consulta; sem cache, aquele resultado fica indisponível.
- “Último mês publicado” corresponde ao IPCA mais recente. Cada indicador tem sua cobertura verificada separadamente. Meses ainda abertos nunca são apresentados como histórico completo.

## Convenções e limitações

Os valores são do **fim de cada mês**. Para janeiro → março, acumulam-se fevereiro e março. Na direção inversa, divide-se pelo fator; o mês inicial não é acumulado. A partir de julho de 1994, sujeito à cobertura da fonte.

O valor inicial na moeda de origem é convertido em reais na origem. Aplica-se o fator brasileiro e converte-se para a moeda de apresentação em cada mês. A cotação é a última PTAX de venda do boletim de fechamento disponível no mês, em reais por unidade da moeda. O indicador dólar mantém a quantidade de dólares comprada na origem. A variação exibida é medida na moeda de apresentação e pode incorporar câmbio; não mede inflação do país estrangeiro.

CDI: percentual aplicado à taxa de cada dia antes da composição. Selic: taxa efetiva diária, sem preço de título. Poupança: rendimento do período iniciado no dia 1 do mês anterior, atribuído ao mês de encerramento (aproximação mensal, sem aniversários individuais; períodos iniciados a partir de maio de 2012). Taxa fixa e juros sobre IPCA são hipóteses do usuário, compostas por taxas mensais equivalentes.

Cenários são opcionais e explícitos. Inflação e juros futuros usam taxas anuais informadas. A projeção do CDI usa 252 dias úteis por ano e 21 por mês para aplicar o percentual escolhido. Cotações futuras são interpoladas geometricamente a partir do último mês encerrado até a cotação final informada. Histórico cambial ausente não é interpolado. Lacunas em índices mensais só são preenchidas mediante ativação explícita de cenários e ficam identificadas como projeção.

Os resultados são **brutos e aproximados**, sem aportes, retiradas, IR, IOF, taxas, spread ou marcação a mercado. Selic e IPCA + juros não simulam um título público específico. Não há inflação estrangeira ou previsão oficial do futuro.

## API

- `GET /api/meta`: catálogo de moedas e última referência publicada do IPCA.
- `POST /api/simulate`: simula indicadores; retorna resultados independentes, séries mensais, fontes, horários de consulta, avisos e indicação de hipóteses. Falha em um indicador não elimina os outros.

Exemplo de corpo:

```json
{
  "amount": 15000,
  "start": "2015-12",
  "end": "2025-12",
  "currency": "BRL",
  "outputCurrency": "BRL",
  "indicators": ["ipca", "inpc", "usd", "cdi"],
  "cdiPercent": 100,
  "fixedRate": 10,
  "realRate": 6,
  "allowProjection": false,
  "scenarios": {},
  "fxScenarios": {}
}
```

Taxas são percentuais, valores monetários são números decimais, datas usam `AAAA-MM`. Cenários aceitam chaves `ipca`, `inpc`, `cdi`, `selic` e `savings`; `fxScenarios` mapeia códigos de moeda para cotação final em reais. A taxa fixa e o adicional real são aplicados também ao histórico como hipóteses explícitas. O CSV exporta os pontos mensais na direção da simulação.
