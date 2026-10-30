# WhatsApp IA

App de desktop (Mac e Windows) que lê mensagens do WhatsApp e responde com um agente de IA.

## Como instalar
1. Instale o Node.js 18 ou mais novo (nodejs.org).
2. Abra um terminal nesta pasta e rode:
   - `npm install` (baixa também um Chromium usado pelo WhatsApp Web, demora um pouco)
   - `npm start`
3. Em **Configurações**, escolha o provedor, cole sua chave de API e salve.
4. Clique em **Conectar WhatsApp** e escaneie o QR Code: WhatsApp → Aparelhos conectados → Conectar um aparelho.
5. Em **Prompts**, escreva as instruções-base da IA (empresa, tom, preços, regras).

## Fotos e áudios
Com o provedor **Gemini**, a IA entende fotos e áudios enviados pelos clientes (o app baixa a mídia e envia junto com a conversa). Com Claude ou OpenAI, o app só lê texto. Por padrão, no modo autônomo, respostas a fotos e áudios viram rascunho para você revisar (dá para mudar em Configurações). Para o modelo, use o nome atual que aparece no Google AI Studio (aistudio.google.com), onde você também cria a chave de API.

## Agenda (Cal.com)
Em **Configurações → Agenda (Cal.com)**, cole a chave de API (Settings → Developer → API Keys no Cal.com), seu usuário e o tipo de evento, e use **Testar conexão**. A IA passa a ver os horários livres dos próximos dias (o Cal.com já considera o seu Google Agenda) e só oferece horários da lista. Quando o cliente confirma horário, nome e e-mail, o app mostra um **agendamento sugerido** no rascunho. Nada é marcado sem você clicar em **Enviar e agendar**, mesmo no modo autônomo.

## Outras funções
- **Você assume a conversa:** se você responde pelo celular, a mensagem entra no histórico e a IA pausa naquela conversa por alguns minutos (configurável).
- **Atendente humano:** se o cliente pedir uma pessoa, estiver irritado ou a IA não souber, ela marca a conversa, pausa nela e o app mostra uma notificação. Clique em **Retomar IA** quando quiser que ela volte.
- **Horário de atendimento:** no modo autônomo, fora do horário a IA não responde e manda um aviso (uma vez a cada 12 horas por contato).
- **Notas sobre o cliente:** em cada conversa, um campo de notas que a IA lê. O app também informa à IA o nome do cliente e a data e hora atuais.
- **Testar a IA:** aba para conversar com a IA como se fosse um cliente, sem enviar nada no WhatsApp. Use para ajustar os prompts com segurança.
- **Computador acordado:** no modo autônomo o app impede o computador de dormir e pode abrir sozinho quando o computador ligar.

## Modos
- **Você revisa:** a IA cria um rascunho (com o raciocínio dela). Você edita e clica em Enviar.
- **Autônomo:** a IA responde sozinha, com espera aleatória e "digitando…", respeitando o limite por hora. Voltar para "Você revisa" cancela respostas que ainda estão esperando para sair.

Você também pode pausar a IA em uma conversa específica e escolher um prompt diferente para cada contato.

## Publicar os instaladores no GitHub (automático)
1. Crie um repositório no GitHub e envie esta pasta para ele (`git init`, `git add .`, `git commit`, `git remote add origin ...`, `git push`).
2. No repositório, abra Settings → Actions → General → Workflow permissions e marque **Read and write permissions**.
3. Para lançar uma versão, crie uma tag e envie:
   `git tag v1.0.0` e depois `git push origin v1.0.0`
4. O GitHub Actions gera sozinho o instalador do Windows (.exe) e do Mac (.dmg, Intel e Apple Silicon) e os coloca na aba **Releases** do repositório. É o link que você passa para as pessoas baixarem.
5. Para uma nova versão, aumente o número em `package.json` e repita com a tag `v1.0.1`, `v1.1.0` etc.

Para gerar na sua própria máquina: `npm run dist` (Mac gera .dmg, Windows gera .exe). Os arquivos saem na pasta `dist`.

### Detalhes do instalador
- O instalador **não** leva um Chromium junto. O app usa o Microsoft Edge (já vem no Windows) ou o Google Chrome. No Mac é preciso ter o Chrome, Edge ou Brave instalado.
- Os instaladores não são assinados. No Windows pode aparecer o aviso "O Windows protegeu seu computador": clique em Mais informações → Executar assim mesmo. No Mac, clique com o botão direito no app → Abrir na primeira vez. Assinar exige certificados pagos (Apple Developer e certificado de código do Windows).
- Troque `Seu Nome` em `package.json` e, se quiser, coloque ícones em uma pasta `build` (`icon.icns` para Mac e `icon.ico` para Windows).

## Avisos importantes
- Este app usa a biblioteca não oficial whatsapp-web.js. Isso vai contra os termos do WhatsApp e **o número pode ser banido**, principalmente no modo autônomo com muitas mensagens. Use um número que você aceite perder, mantenha os limites de espera e de respostas por hora, e comece no modo "Você revisa".
- As conversas, os prompts e a chave de API ficam salvos em um arquivo no seu computador (pasta de dados do app).
- Eu não consegui rodar o app aqui (sem acesso à internet para instalar as dependências), então a primeira execução pode precisar de pequenos ajustes.
