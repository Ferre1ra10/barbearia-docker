# Barbearia Fila — Projeto 3

Sistema de fila de atendimento para barbearia, executado em três containers
Docker (frontend, backend e banco de dados) orquestrados por Docker Compose.

Atividade: **Guia de Desafios — Projeto 3, Barbearia Fila**.

---

## 1. Como executar

Pré-requisito: Docker Desktop instalado e **em execução**.

```bash
docker volume create dados_barbearia
docker network create rede-barbearia
docker compose up -d --build
```

Depois de subir, abra no navegador:

| O que    | Endereço                            |
|----------|-------------------------------------|
| Frontend | http://localhost:8084               |
| Backend  | http://localhost:3004/fila          |
| Banco    | interno à rede, sem porta publicada |

Conferir se os três containers estão de pé:

```bash
docker ps
```

Derrubar tudo (o volume e a rede continuam existindo):

```bash
docker compose down
```

> **Atenção:** o `banco/init.sql` só é executado quando o volume está vazio.
> Se você alterar o schema, apague o volume antes de subir de novo:
> `docker compose down && docker volume rm dados_barbearia && docker volume create dados_barbearia`

---

## 2. O que foi usado

| Camada   | Tecnologia            | Por quê                                                     |
|----------|-----------------------|-------------------------------------------------------------|
| Frontend | HTML, CSS e JavaScript puro, servidos por **Nginx** | Página estática não precisa de framework nem de build |
| Backend  | **Node.js 20** com Express e mysql2 | API REST que conversa com o banco |
| Banco    | **MySQL 8.0**         | Imagem oficial, inicializada por script SQL                 |
| Orquestração | **Docker Compose**  | Sobe os três serviços com um comando só                     |
| Fontes   | Bebas Neue e Inter (Google Fonts) | Tipografia condensada para títulos e legível no corpo |

Nenhuma dependência foi instalada na máquina: Node e MySQL rodam apenas dentro
dos containers.

---

## 3. Estrutura do projeto

```
barbearia-docker/
├── docker-compose.yml     orquestra os três serviços
├── .dockerignore          evita copiar node_modules para a imagem
├── frontend/
│   ├── Dockerfile         imagem Nginx com os arquivos estáticos
│   ├── index.html         estrutura da página
│   ├── style.css          tema visual e animações
│   └── script.js          consome a API e desenha a tela
├── backend/
│   ├── Dockerfile         imagem Node.js com a API
│   ├── package.json       dependências (express, cors, mysql2)
│   └── server.js          rotas da API
└── banco/
    └── init.sql           cria as tabelas e os dados iniciais
```

---

## 4. Como foi feito

### 4.1 Dockerfile do frontend

O frontend é só HTML, CSS e JS — não precisa compilar nada. A imagem parte do
Nginx e copia os arquivos para a pasta que ele serve:

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
```

### 4.2 Dockerfile do backend

O backend é uma aplicação Node.js. O `package.json` é copiado antes do resto do
código: assim o Docker reaproveita a camada do `npm install` em cada rebuild,
desde que as dependências não tenham mudado.

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3004
CMD ["npm", "start"]
```

### 4.3 Rede e volume

Criados **antes** do Compose, conforme o enunciado:

```bash
docker volume create dados_barbearia
docker network create rede-barbearia
```

Por isso os dois aparecem como `external: true` no `docker-compose.yml`: o
Compose os utiliza, mas não é o dono deles. Sem isso, o Compose criaria uma rede
e um volume próprios, com nomes prefixados pelo nome do projeto.

### 4.4 docker-compose.yml

Os três serviços, todos na mesma rede:

- **front** — publica a porta `8084:80`.
- **back** — publica `3004:3004` e recebe os dados de conexão do banco por
  variáveis de ambiente, para que nenhuma senha fique escrita no código.
- **banco** — MySQL 8.0, com `MYSQL_DATABASE: barbearia` e dois volumes montados:
  o volume nomeado em `/var/lib/mysql` e o `init.sql` em
  `/docker-entrypoint-initdb.d/`, que o MySQL executa sozinho na primeira subida.

Dois detalhes que fazem a aplicação subir de forma confiável:

- **`healthcheck` no banco** com `depends_on: condition: service_healthy`. Sem
  isso o backend inicia antes de o MySQL aceitar conexões e quebra.
- **`restart: unless-stopped`** no backend, como rede de segurança.

### 4.5 Banco de dados

Quatro tabelas criadas pelo `banco/init.sql`:

| Tabela      | Conteúdo                                                     |
|-------------|--------------------------------------------------------------|
| `servicos`  | nome, duração em minutos e preço base                        |
| `barbeiros` | nome e se está atendendo hoje                                |
| `precos`    | preço de cada serviço para cada barbeiro (chave composta)    |
| `fila`      | cliente, serviço, barbeiro, status e horários do atendimento |

---

## 5. Por que Docker neste projeto

**Por que Dockerfile.** O frontend e o backend são código próprio, então não
existe imagem pronta para eles. O Dockerfile é a receita que descreve como
transformar esse código em imagem: de qual imagem base partir, o que copiar e
qual comando executar. Quem clonar o repositório roda um comando e obtém
exatamente o mesmo ambiente, sem instalar Node nem MySQL na própria máquina.

**Por que Docker Compose.** A aplicação precisa de três processos no ar ao mesmo
tempo, na ordem certa e conversando entre si. Subir container por container na
mão seria trabalhoso e fácil de errar. O Compose descreve tudo em um arquivo e
sobe com `docker compose up -d --build`.

**Por que a rede.** Containers na mesma rede enxergam uns aos outros pelo nome do
serviço. O backend conecta no host `banco`, que o DNS interno do Docker resolve.
Por isso o MySQL **não** precisa ter porta publicada no host: ele só é acessado
de dentro da rede, o que também é mais seguro.

**Por que o volume.** O sistema de arquivos de um container é descartável: ao
remover o container, tudo que estava dentro dele se perde. O volume
`dados_barbearia` é montado em `/var/lib/mysql`, onde o MySQL guarda os dados.
Assim os registros sobrevivem a `docker compose down` seguido de `up`.

**Portas.** O frontend é acessado em `http://localhost:8084` e o backend em
`http://localhost:3004`. O mapeamento `8084:80` significa: porta 8084 do
computador direcionada para a porta 80 do container, onde o Nginx escuta.

---

## 6. Funcionalidades

- Fila ao vivo, atualizada a cada 5 segundos sem recarregar a página.
- Tempo de espera estimado **por barbeiro** — cada um tem a própria cadeira, então
  o cliente só espera quem está na frente dele naquela fila.
- Tabela de preços por barbeiro, editável na própria tela.
- Disponibilidade do dia: desmarcar um barbeiro o remove do formulário sem apagar
  quem já está na fila dele.
- O formulário mostra preço e espera estimada antes de confirmar o cadastro.
- Ciclo de atendimento: aguardando → atendendo → atendido, além de desistência.
- Painel do dia: clientes na fila, atendimentos, faturamento e espera estimada.
- Ranking de cortes e faturamento por barbeiro.
- Busca por nome dentro da fila.
- Layout responsivo, com animações; respeita `prefers-reduced-motion`.

---

## 7. Rotas da API

| Método | Rota                           | O que faz                                     |
|--------|--------------------------------|-----------------------------------------------|
| GET    | `/config`                      | serviços, barbeiros e preços para a tela       |
| GET    | `/fila`                        | fila de hoje com posição e espera estimada     |
| POST   | `/fila`                        | coloca um cliente na fila                      |
| PUT    | `/fila/:id/chamar`             | chama o cliente para a cadeira                 |
| PUT    | `/fila/:id/finalizar`          | encerra o atendimento                          |
| PUT    | `/fila/:id/desistir`           | marca que o cliente foi embora                 |
| PUT    | `/barbeiros/:id`               | liga/desliga o barbeiro do expediente          |
| PUT    | `/precos/:barbeiro/:servico`   | edita um preço                                 |
| GET    | `/stats`                       | números do dia e ranking dos barbeiros         |

---

## 8. Verificação exigida pela atividade

**1. A aplicação abre no navegador e o cadastro funciona.**
Abra http://localhost:8084, preencha nome, barbeiro e serviço e clique em
"Adicionar à fila". O cliente aparece na lista imediatamente.

**2. Um registro cadastrado continua lá depois de `docker compose down` + `up`.**

```bash
docker compose down
docker compose up -d
```

Aguarde alguns segundos e recarregue a página: a fila e o faturamento do dia
continuam preenchidos, porque os dados estão no volume `dados_barbearia`, não
dentro do container.
