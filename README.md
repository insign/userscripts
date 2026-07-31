# [Coleção de Userscripts](https://github.com/insign/userscripts) por [@insign](https://github.com/insign)

Este repositório contém uma coleção de userscripts úteis para melhorar a experiência de navegação em diversos sites.

## Instalação Geral

1.  **Instale um Gerenciador de Userscripts:** Você precisará de uma extensão de navegador como [Tampermonkey](https://www.tampermonkey.net/) (recomendado para Chrome, Firefox, Edge, Opera) ou [Violentmonkey](https://violentmonkey.github.io/) (alternativa de código aberto). Para Safari/iOS, procure por extensões como [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887).
2.  **Instale o Script Desejado:** Clique nos links "Instalar" abaixo para cada script que você deseja usar. Seu gerenciador de userscripts deverá abrir uma página para confirmar a instalação.
3.  **Use:** Após a instalação, o script será executado automaticamente nos sites correspondentes ou estará disponível através de botões/atalhos, conforme descrito abaixo.
4.  **Atualizações:** Seu gerenciador de userscripts geralmente verificará atualizações automaticamente. Você também pode verificar manualmente nas configurações da extensão.
5.  **Bugs/Sugestões:** Se encontrar algum problema ou tiver ideias, abra uma [issue](https://github.com/insign/userscripts/issues) neste repositório.

---

## Scripts Disponíveis

### Remove URL Trackers

*   **Descrição:** Remove parâmetros de rastreamento irritantes de URLs (como `utm_*`, `ref`, `fbclid`, etc.) diretamente na barra de endereços do navegador. Útil para limpar links antes de compartilhá-los.
*   **Instalar:** [Greasy Fork](https://greasyfork.org/pt-BR/scripts/508850-remove-url-trackers)
*   **Nota:** Este script altera a URL na barra de endereços assim que a página carrega.

### Easy Copy URL without Trackers

*   **Descrição:** Permite copiar a URL da página atual para a área de transferência, removendo automaticamente os parâmetros de rastreamento. Ativado pelo atalho `Alt+C` (ou `Option+C` no Mac). Uma notificação confirma a cópia.
*   **Instalar:** [Greasy Fork](https://greasyfork.org/en/scripts/509058-easy-copy-url-without-trackers)
*   **Uso:** Pressione `Alt+C` / `Option+C` em qualquer página.

### Summarize with AI (OpenAI/Gemini)

* **Descrição:** Adiciona um botão discreto ('S') em páginas detectadas como artigos ou notícias. Ao clicar, utiliza o
  último modelo de IA selecionado (OpenAI ou Gemini) para gerar um resumo conciso do conteúdo. Pede a chave da API no
  primeiro uso de cada serviço ou se ela for apagada. O resumo é exibido em um overlay na língua do navegador. Permite
  adicionar modelos customizados.

* **Novidades (v2026.07.28):**
    * **Modelos Gemini Nativos:** Suporte a Gemini 3.6 Flash (`gemini-3.6-flash`) e Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`).
    * **Thinking nos Modelos Gemini:** Os novos modelos usam `thinkingLevel`, compatível com Gemini 3.x: `minimal` no Flash-Lite e `low` no Flash.
    * **Respostas Multipartes:** Suporte a respostas Gemini compostas por múltiplas partes, sem exibir as partes de pensamento.
    * **Compartilhamento:** Três botões compartilham o primeiro parágrafo do resumo, a opinião ou o resumo completo; todos incluem a URL original, usam cópia automática como fallback e exibem um texto selecionável se o navegador bloquear ambas as opções.

* **Novidades (v2025.07.17):**
    * **Chat de Follow-up:** Novo botão 💬 ao lado do X permite continuar a conversa sobre o artigo. Faça perguntas de
      acompanhamento e aprofunde-se no conteúdo como em um chat normal.
    * **Tipografia para Leitura:** Interface redesenhada com fonte serifada (Georgia) otimizada para leitura confortável,
      line-height de 1.75 e espaçamentos melhorados.
    * **Dark Mode Aprimorado:** Detecta automaticamente o modo escuro do sistema/navegador e adapta todas as cores com
      `!important` para garantir visualização correta em qualquer site.
    * **Timeout Inteligente:** Modelos com "thinking" (Pro, o3, o4) agora têm timeout de 3 minutos para evitar erros de
      timeout durante processamentos mais longos.
    * **Prompt Melhorado:**
        * O primeiro parágrafo agora responde diretamente a pergunta implícita no título do artigo (anti-clickbait)
        * A opinião é mais direta e autoritativa, cética quando justificado, como um especialista dando seu parecer
    * **CSS Isolado:** Usa `all: revert !important` para garantir que os estilos do overlay não sejam afetados por
      estilos de sites externos.

* **Recursos:**
    * Avaliação da qualidade do artigo colorida (excelente, bom, médio, ruim, muito ruim)
    * Adaptação automática ao dark mode do sistema
    * Interface responsiva para mobile (tap-and-hold para selecionar modelo)
    * Suporte a modelos customizados (OpenAI e Gemini)

*   **Instalar:** [Greasy Fork](https://greasyfork.org/en/scripts/509192-summarize-with-ai)

* **Uso:**
    * **Clique simples** no botão 'S' no canto inferior esquerdo: Inicia a sumarização com o último modelo usado. O
      botão some ao rolar a página para baixo e reaparece ao rolar para cima.
    * **Long Press** (segurar por 0.5s) no botão 'S': Abre o menu para selecionar um modelo diferente.
    * **Atalho `Alt+S`**: Inicia a sumarização com o último modelo usado.
    * **Botão 💬 (Chat)**: Após o resumo, clique para abrir a área de chat e fazer perguntas sobre o artigo.
    * **Resetar API Key**: No menu de modelos, clique em "Reset Key" ao lado do serviço (OpenAI/Gemini).
    * **Erro na Sumarização**: Um botão "Try Again" aparecerá no overlay em caso de erro.

*   **Dependências:** Requer chaves de API válidas para OpenAI e/ou Google Gemini (AI Studio).

### Better LMArena (lmsys) Chat
> Esse script vai ser desativado em breve com o advento da nova versão do frontend.

*   **Descrição:** Melhora a interface do chat do LMSYS (LM Arena), tornando-a mais limpa e compacta. Remove alguns avisos e blocos de texto iniciais, ajusta espaçamentos e renomeia abas para melhor clareza. Bloqueia `alert()`s iniciais.
*   **Instalar:** [Greasy Fork](https://greasyfork.org/en/scripts/489922-better-lmsys-chat)
*   **Sites:** `chat.lmsys.org`, `lmarena.ai`

### AI Prompt Manager

*   **Descrição:** Adiciona um botão flutuante (ícone de prancheta) para gerenciar (criar, editar, excluir e inserir) prompts reutilizáveis em sites de chat de IA. Atualmente suporta apenas o DeepSeek Chat.
*   **Instalar:** [Greasy Fork](https://greasyfork.org/en/scripts/527374-ai-prompt-manager)
*   **Sites:** `chat.deepseek.com`
*   **Uso:** Clique no botão 📋 para abrir o gerenciador. Clique em um prompt salvo para inseri-lo na caixa de texto.

### Poe Notifier

*   **Descrição:** Monitora o site Poe.com pela mensagem "Waiting...". Quando o processamento começa, muda o favicon da aba para um círculo laranja. Quando o processamento termina, envia uma notificação do navegador e mantém o ícone laranja. Ao focar a aba novamente (e se não estiver mais esperando), restaura o favicon original.
*   **Instalar:** [Greasy Fork](https://greasyfork.org/en/scripts/509193-poe-notifier) (Nota: Link hipotético, o script `poe-notifier.js` não tinha cabeçalho com URLs GreasyFork, você precisará criá-lo se for publicar).
*   **Sites:** `poe.com`
*   **Nota:** Requer permissão de notificações do navegador para funcionar completamente.

---

## Contribuições

Contribuições, sugestões e relatos de bugs são bem-vindos! Por favor, use as [Issues](https://github.com/insign/userscripts/issues) do GitHub.

## "Diga Obrigado"

Se você achou algum desses scripts útil, considere dar uma estrela ⭐ neste repositório no [GitHub](https://github.com/insign/userscripts)!

## Licença

Todos os scripts neste repositório são licenciados sob a [DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE (WTFPL)](./LICENSE). Faça o que quiser com eles.
