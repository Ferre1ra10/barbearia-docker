CREATE TABLE IF NOT EXISTS servicos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(50) NOT NULL,
  duracao_min INT NOT NULL,
  preco_base DECIMAL(6,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS barbeiros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(50) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Cada barbeiro tem a propria tabela de precos: o mais experiente cobra mais
-- pelo mesmo corte. A chave composta garante um preco por dupla barbeiro/servico.
CREATE TABLE IF NOT EXISTS precos (
  barbeiro_id INT NOT NULL,
  servico_id  INT NOT NULL,
  preco DECIMAL(6,2) NOT NULL,
  PRIMARY KEY (barbeiro_id, servico_id),
  FOREIGN KEY (barbeiro_id) REFERENCES barbeiros(id) ON DELETE CASCADE,
  FOREIGN KEY (servico_id)  REFERENCES servicos(id)  ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fila (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  telefone VARCHAR(20),
  servico_id  INT NOT NULL,
  barbeiro_id INT NOT NULL,
  status ENUM('aguardando','atendendo','atendido','desistiu') NOT NULL DEFAULT 'aguardando',
  criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em   DATETIME,
  finalizado_em DATETIME,
  FOREIGN KEY (servico_id)  REFERENCES servicos(id),
  FOREIGN KEY (barbeiro_id) REFERENCES barbeiros(id)
);

INSERT INTO servicos (nome, duracao_min, preco_base) VALUES
  ('Corte',          30, 45.00),
  ('Barba',          20, 35.00),
  ('Corte + Barba',  45, 70.00),
  ('Pezinho',        10, 20.00),
  ('Platinado',      90, 150.00);

INSERT INTO barbeiros (nome) VALUES
  ('Marcos'), ('Rafael'), ('Juninho');

-- Todo barbeiro comeca com o preco base de cada servico; a tela edita depois.
INSERT INTO precos (barbeiro_id, servico_id, preco)
SELECT b.id, s.id, s.preco_base FROM barbeiros b CROSS JOIN servicos s;

-- O Marcos e o mais antigo da casa e cobra um pouco mais.
UPDATE precos SET preco = preco * 1.2 WHERE barbeiro_id = 1;
