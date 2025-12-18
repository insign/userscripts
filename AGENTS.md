# Regras importantes para desenvolvimento de userscripts

- Sempre que for fazer um novo commit, incremente o número da versão do userscript, em '// @version', exemplo '// @version 2025.07.17.1430' onde a versão segue o padrão YYYY.MM.DD.HHMM (data e hora atual)
- Prefira strings do frontend em inglês
- Use o padrão de código do JavaScript ES6, priorizando arrow functions quando simples ou simplificáveis
- Sempre que possível, faça uso de async/await, promises, try/catch e boas práticas modernas
- Use try/catch para tratamento de erros e faça console.log do erro para depuração, e resposta visual para o usuário
