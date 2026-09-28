const API = `http://${location.hostname}:3004`;

const $ = (id) => document.getElementById(id);
const lista = $("lista");
const dinheiro = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

let filaAtual = [];
let servicos = [];
let barbeiros = [];
let precos = new Map(); // "barbeiroId:servicoId" -> preco

const chave = (b, s) => `${b}:${s}`;

// Escapa o que veio do banco antes de jogar no HTML.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(texto, tipo = "") {
  const el = document.createElement("div");
  el.className = `toast ${tipo}`;
  el.textContent = texto;
  $("toasts").append(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(rota, opcoes) {
  const r = await fetch(API + rota, opcoes);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || "erro");
  return r.status === 204 ? null : r.json();
}

const enviar = (rota, corpo) =>
  api(rota, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

// Anima o numero do KPI subindo ate o valor novo, em vez de trocar seco.
function contarAte(el, alvo, formatar = (n) => n) {
  const inicio = Number(el.dataset.valor || 0);
  if (inicio === alvo) return;
  el.dataset.valor = alvo;
  const t0 = performance.now();
  const passo = (t) => {
    const p = Math.min((t - t0) / 500, 1);
    const suave = 1 - Math.pow(1 - p, 3);
    el.textContent = formatar(Math.round(inicio + (alvo - inicio) * suave));
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function minutos(m) {
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// ---------- fila ----------

// O painel recarrega a cada 5s. Sem estas duas travas a lista inteira seria
// recriada toda vez e a animacao de entrada rodaria de novo, piscando a tela.
let ultimoDesenho = "";
let jaAnimados = new Set();

function desenharFila() {
  const busca = $("busca").value.trim().toLowerCase();
  const visiveis = busca
    ? filaAtual.filter((c) => c.nome.toLowerCase().includes(busca))
    : filaAtual;

  const assinatura = busca + "|" + JSON.stringify(visiveis);
  if (assinatura === ultimoDesenho) return;
  ultimoDesenho = assinatura;

  $("vazio").style.display = visiveis.length ? "none" : "block";
  $("vazio").textContent = filaAtual.length
    ? "Nenhum cliente com esse nome."
    : "Ninguem na fila. Cadeira livre.";

  // A numeracao e por barbeiro: cada cadeira tem a propria fila.
  const posicao = {};
  let novos = 0;
  lista.innerHTML = visiveis.map((c) => {
    const atendendo = c.status === "atendendo";
    if (!atendendo) posicao[c.barbeiro_id] = (posicao[c.barbeiro_id] || 0) + 1;
    const novo = !jaAnimados.has(c.id);
    const atraso = novo ? `style="animation-delay:${novos++ * 40}ms"` : "";
    return `
      <li class="item ${atendendo ? "atendendo" : ""} ${novo ? "novo" : ""}" ${atraso}>
        <div class="posicao">${atendendo ? "&#9986;" : posicao[c.barbeiro_id]}</div>
        <div>
          <div class="item-nome">${esc(c.nome)}</div>
          <div class="item-info">
            <span class="etiqueta destaque">${esc(c.barbeiro)}</span>
            <span class="etiqueta">${esc(c.servico)}</span>
            <span class="etiqueta">${dinheiro.format(Number(c.preco))}</span>
            ${c.telefone ? `<span class="etiqueta">${esc(c.telefone)}</span>` : ""}
            <span>${atendendo
              ? "na cadeira agora"
              : `espera ~ ${minutos(c.espera_min)} com ${esc(c.barbeiro)}`}</span>
          </div>
        </div>
        <div class="acoes">
          ${atendendo
            ? `<button class="acao ok" data-id="${c.id}" data-acao="finalizar">Finalizar</button>`
            : `<button class="acao principal" data-id="${c.id}" data-acao="chamar">Chamar</button>
               <button class="acao perigo" data-id="${c.id}" data-acao="desistir">Desistiu</button>`}
        </div>
      </li>`;
  }).join("");

  jaAnimados = new Set(filaAtual.map((c) => c.id));
}

async function carregar() {
  try {
    const [fila, stats] = await Promise.all([api("/fila"), api("/stats")]);
    filaAtual = fila;
    desenharFila();
    resumo();

    const aguardando = fila.filter((c) => c.status === "aguardando");
    contarAte($("kpi-fila"), aguardando.length);
    contarAte($("kpi-atendidos"), stats.atendidos);
    contarAte($("kpi-faturamento"), Math.round(Number(stats.faturamento)), (n) => dinheiro.format(n));

    // A espera do painel e a maior entre as cadeiras: e quanto tempo leva
    // para a barbearia inteira esvaziar, nao a soma de todas as filas.
    const porBarbeiro = {};
    for (const c of fila) porBarbeiro[c.barbeiro_id] = (porBarbeiro[c.barbeiro_id] || 0) + c.duracao_min;
    contarAte($("kpi-espera"), Math.max(0, ...Object.values(porBarbeiro)), minutos);

    $("ranking").innerHTML = stats.por_barbeiro.map((b) => `
      <li class="${b.ativo ? "" : "inativo"}">
        <strong>${esc(b.nome)}${b.ativo ? "" : " (fora hoje)"}</strong>
        <span>${b.atendidos} corte(s) &middot; ${dinheiro.format(Number(b.faturamento))}</span>
      </li>`).join("");
  } catch {
    toast("Backend fora do ar. Confira com docker ps.", "erro");
  }
}

// Um unico listener na lista cobre todos os botoes, inclusive os que ainda
// nao existem -- a lista e redesenhada a cada atualizacao.
lista.onclick = async (e) => {
  const btn = e.target.closest("button[data-acao]");
  if (!btn) return;
  const { id, acao } = btn.dataset;
  if (acao === "desistir" && !confirm("Remover este cliente da fila?")) return;
  btn.closest(".item").classList.add("saindo");
  try {
    await api(`/fila/${id}/${acao}`, { method: "PUT" });
    toast({ chamar: "Cliente chamado.", finalizar: "Atendimento finalizado.", desistir: "Cliente removido." }[acao]);
    carregar();
  } catch (err) {
    btn.closest(".item").classList.remove("saindo");
    toast(err.message, "erro");
  }
};

// ---------- formulario ----------

// Mostra o preco do barbeiro escolhido e quanto esse cliente vai esperar
// na cadeira dele, antes mesmo de entrar na fila.
function resumo() {
  const b = Number($("barbeiro").value);
  const s = Number($("servico").value);
  const preco = precos.get(chave(b, s));
  if (!b || !s || preco === undefined) return ($("resumo").textContent = "");

  const espera = filaAtual
    .filter((c) => c.barbeiro_id === b)
    .reduce((soma, c) => soma + c.duracao_min, 0);
  const nome = barbeiros.find((x) => x.id === b)?.nome ?? "";

  $("resumo").innerHTML =
    `<strong>${dinheiro.format(Number(preco))}</strong> com ${esc(nome)} &middot; ` +
    (espera ? `entra na fila e espera ~ ${minutos(espera)}` : "cadeira livre agora");
}

$("form").onsubmit = async (e) => {
  e.preventDefault();
  const corpo = {
    nome: $("nome").value,
    telefone: $("telefone").value,
    servico_id: Number($("servico").value),
    barbeiro_id: Number($("barbeiro").value),
  };
  try {
    await api("/fila", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const s = servicos.find((s) => s.id === corpo.servico_id);
    toast(`${corpo.nome} entrou na fila (${s.nome}).`);
    $("nome").value = "";
    $("telefone").value = "";
    $("nome").focus();
    carregar();
  } catch (err) {
    toast(err.message, "erro");
  }
};

$("busca").oninput = desenharFila;
$("barbeiro").onchange = resumo;
$("servico").onchange = resumo;

// ---------- precos e disponibilidade ----------

function preencherSelects() {
  const ativos = barbeiros.filter((b) => b.ativo);
  const anterior = $("barbeiro").value;

  $("barbeiro").innerHTML = ativos.length
    ? ativos.map((b) => `<option value="${b.id}">${esc(b.nome)}</option>`).join("")
    : `<option value="">Nenhum barbeiro atendendo</option>`;
  if (ativos.some((b) => String(b.id) === anterior)) $("barbeiro").value = anterior;

  $("servico").innerHTML = servicos
    .map((s) => `<option value="${s.id}">${esc(s.nome)} — ${minutos(s.duracao_min)}</option>`)
    .join("");
  resumo();
}

function desenharGestao() {
  $("gestao-cabecalho").innerHTML = `
    <tr>
      <th>Serviço</th>
      ${barbeiros.map((b) => `
        <th class="${b.ativo ? "" : "inativo"}">
          <label class="chave">
            <input type="checkbox" data-barbeiro="${b.id}" ${b.ativo ? "checked" : ""}>
            ${esc(b.nome)}
          </label>
        </th>`).join("")}
    </tr>`;

  $("gestao-corpo").innerHTML = servicos.map((s) => `
    <tr>
      <td class="servico-nome">${esc(s.nome)} <span>${minutos(s.duracao_min)}</span></td>
      ${barbeiros.map((b) => `
        <td>
          <input class="preco" type="number" min="0" max="9999" step="0.50"
                 value="${Number(precos.get(chave(b.id, s.id)) ?? 0).toFixed(2)}"
                 data-barbeiro="${b.id}" data-servico="${s.id}">
        </td>`).join("")}
    </tr>`).join("");
}

// Salva no blur/Enter, nao a cada tecla digitada.
$("gestao").addEventListener("change", async (e) => {
  const el = e.target;

  if (el.matches("input[type=checkbox][data-barbeiro]")) {
    const id = Number(el.dataset.barbeiro);
    try {
      await enviar(`/barbeiros/${id}`, { ativo: el.checked });
      barbeiros.find((b) => b.id === id).ativo = el.checked;
      preencherSelects();
      desenharGestao();
      toast(`${barbeiros.find((b) => b.id === id).nome} ${el.checked ? "voltou ao expediente" : "saiu do expediente"}.`);
      carregar();
    } catch (err) {
      el.checked = !el.checked;
      toast(err.message, "erro");
    }
    return;
  }

  if (el.matches("input.preco")) {
    const b = Number(el.dataset.barbeiro);
    const s = Number(el.dataset.servico);
    const anterior = precos.get(chave(b, s));
    try {
      await enviar(`/precos/${b}/${s}`, { preco: Number(el.value) });
      precos.set(chave(b, s), Number(el.value).toFixed(2));
      el.value = Number(el.value).toFixed(2);
      el.classList.add("salvo");
      setTimeout(() => el.classList.remove("salvo"), 900);
      toast("Preço atualizado.");
      resumo();
    } catch (err) {
      el.value = Number(anterior).toFixed(2);
      toast(err.message, "erro");
    }
  }
});

// ---------- inicio ----------

function relogio() {
  $("relogio").textContent = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function iniciar() {
  try {
    const config = await api("/config");
    servicos = config.servicos;
    barbeiros = config.barbeiros;
    precos = new Map(config.precos.map((p) => [chave(p.barbeiro_id, p.servico_id), p.preco]));
    preencherSelects();
    desenharGestao();
  } catch {
    toast("Nao consegui carregar servicos e barbeiros.", "erro");
  }
  relogio();
  setInterval(relogio, 1000);
  carregar();
  // ponytail: so a fila e o painel recarregam sozinhos. Precos e disponibilidade
  // sao lidos uma vez, no inicio -- se a barbearia operar em duas telas ao mesmo
  // tempo, incluir /config neste ciclo (cuidando para nao sobrescrever um campo
  // que esteja sendo digitado).
  setInterval(carregar, 5000); // painel ao vivo, como nos sistemas de fila reais
}

iniciar();
