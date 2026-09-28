const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// Erro no banco vira 500 com mensagem, em vez de derrubar o processo.
const rota = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ erro: "falha no banco" });
  });

// Serviços, barbeiros e a tabela de preços que a tela usa para montar
// o formulário e o painel de edição.
app.get("/config", rota(async (_req, res) => {
  const [servicos]  = await db.query("SELECT * FROM servicos ORDER BY id");
  const [barbeiros] = await db.query("SELECT * FROM barbeiros ORDER BY nome");
  const [precos]    = await db.query("SELECT * FROM precos");
  res.json({ servicos, barbeiros, precos });
}));

// Fila do dia. A espera é calculada por barbeiro: cada um tem a própria
// cadeira, então o cliente só espera quem está na frente dele NAQUELA fila.
app.get("/fila", rota(async (_req, res) => {
  const [linhas] = await db.query(`
    SELECT f.id, f.nome, f.telefone, f.status, f.criado_em, f.iniciado_em,
           f.barbeiro_id, s.nome AS servico, s.duracao_min,
           b.nome AS barbeiro, p.preco
    FROM fila f
    JOIN servicos  s ON s.id = f.servico_id
    JOIN barbeiros b ON b.id = f.barbeiro_id
    JOIN precos    p ON p.barbeiro_id = f.barbeiro_id AND p.servico_id = f.servico_id
    WHERE DATE(f.criado_em) = CURDATE()
      AND f.status IN ('aguardando','atendendo')
    ORDER BY FIELD(f.status,'atendendo','aguardando'), f.id
  `);

  const acumulado = {}; // minutos já comprometidos na cadeira de cada barbeiro
  const fila = linhas.map((c) => {
    const antes = acumulado[c.barbeiro_id] || 0;
    acumulado[c.barbeiro_id] = antes + c.duracao_min;
    return { ...c, espera_min: c.status === "atendendo" ? 0 : antes };
  });
  res.json(fila);
}));

app.post("/fila", rota(async (req, res) => {
  const { nome, telefone, servico_id, barbeiro_id } = req.body;
  if (!nome?.trim() || !servico_id || !barbeiro_id) {
    return res.status(400).json({ erro: "nome, servico_id e barbeiro_id são obrigatórios" });
  }
  const [[barbeiro]] = await db.query("SELECT ativo FROM barbeiros WHERE id = ?", [barbeiro_id]);
  if (!barbeiro) return res.status(404).json({ erro: "barbeiro não encontrado" });
  if (!barbeiro.ativo) return res.status(409).json({ erro: "esse barbeiro não está atendendo hoje" });

  const [r] = await db.query(
    "INSERT INTO fila (nome, telefone, servico_id, barbeiro_id) VALUES (?, ?, ?, ?)",
    [nome.trim(), telefone?.trim() || null, servico_id, barbeiro_id]
  );
  res.status(201).json({ id: r.insertId });
}));

// Mudança de status: chamar, finalizar ou marcar desistência.
const TRANSICOES = {
  chamar:    "status = 'atendendo', iniciado_em = NOW()",
  finalizar: "status = 'atendido', finalizado_em = NOW()",
  desistir:  "status = 'desistiu'",
};

app.put("/fila/:id/:acao", rota(async (req, res) => {
  const set = TRANSICOES[req.params.acao];
  if (!set) return res.status(400).json({ erro: "ação inválida" });
  const [r] = await db.query(`UPDATE fila SET ${set} WHERE id = ?`, [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "cliente não encontrado" });
  res.sendStatus(204);
}));

// Liga e desliga o barbeiro do expediente. Quem já está na fila dele continua:
// desativar só impede novos clientes.
app.put("/barbeiros/:id", rota(async (req, res) => {
  const { ativo } = req.body;
  if (typeof ativo !== "boolean") return res.status(400).json({ erro: "ativo deve ser true ou false" });
  const [r] = await db.query("UPDATE barbeiros SET ativo = ? WHERE id = ?", [ativo, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ erro: "barbeiro não encontrado" });
  res.sendStatus(204);
}));

// Edita o preço de um serviço para um barbeiro específico.
app.put("/precos/:barbeiro_id/:servico_id", rota(async (req, res) => {
  const preco = Number(req.body.preco);
  if (!Number.isFinite(preco) || preco < 0 || preco > 9999) {
    return res.status(400).json({ erro: "preço deve ficar entre 0 e 9999" });
  }
  const [r] = await db.query(
    "UPDATE precos SET preco = ? WHERE barbeiro_id = ? AND servico_id = ?",
    [preco.toFixed(2), req.params.barbeiro_id, req.params.servico_id]
  );
  if (!r.affectedRows) return res.status(404).json({ erro: "combinação não encontrada" });
  res.sendStatus(204);
}));

// Painel do dia: atendimentos, faturamento, tempo médio e ranking dos barbeiros.
app.get("/stats", rota(async (_req, res) => {
  const [[totais]] = await db.query(`
    SELECT COUNT(*) AS atendidos,
           COALESCE(SUM(p.preco), 0) AS faturamento,
           ROUND(AVG(TIMESTAMPDIFF(MINUTE, f.iniciado_em, f.finalizado_em))) AS tempo_medio
    FROM fila f
    JOIN precos p ON p.barbeiro_id = f.barbeiro_id AND p.servico_id = f.servico_id
    WHERE f.status = 'atendido' AND DATE(f.criado_em) = CURDATE()
  `);
  const [porBarbeiro] = await db.query(`
    SELECT b.nome, b.ativo,
           COUNT(f.id) AS atendidos,
           COALESCE(SUM(p.preco), 0) AS faturamento
    FROM barbeiros b
    LEFT JOIN fila f ON f.barbeiro_id = b.id
      AND f.status = 'atendido' AND DATE(f.criado_em) = CURDATE()
    LEFT JOIN precos p ON p.barbeiro_id = f.barbeiro_id AND p.servico_id = f.servico_id
    GROUP BY b.id, b.nome, b.ativo
    ORDER BY atendidos DESC, b.nome
  `);
  res.json({ ...totais, por_barbeiro: porBarbeiro });
}));

app.listen(3004, () => console.log("Backend da barbearia na porta 3004"));
