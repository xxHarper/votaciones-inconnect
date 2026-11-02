CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
CREATE TABLE election(id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed')));
INSERT INTO election(id) VALUES(1);
CREATE TABLE offerings(id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 6), name TEXT NOT NULL, photo BLOB, mime TEXT);
INSERT INTO offerings(id,name) VALUES (1,'Raíces que nos unen'),(2,'Un puente a la memoria'),(3,'Luz para el regreso'),(4,'Entre flores y recuerdos'),(5,'Sabores de nuestra tierra'),(6,'Siempre en el corazón');
CREATE TABLE participants(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', table_id INTEGER NOT NULL REFERENCES offerings(id),
 code_hash TEXT UNIQUE, issued INTEGER NOT NULL DEFAULT 0 CHECK(issued IN(0,1)), voted INTEGER NOT NULL DEFAULT 0 CHECK(voted IN(0,1)),
 CHECK(voted=0 OR code_hash IS NULL)
);
-- Sin identidad, fecha, secuencia ni referencia a sesiones: solo papeletas anónimas.
CREATE TABLE ballots(id TEXT PRIMARY KEY, table_id INTEGER NOT NULL REFERENCES offerings(id)) WITHOUT ROWID;
CREATE TABLE admin(id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL);
CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE voter_sessions(token_hash TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id), expires INTEGER NOT NULL, deadline INTEGER NOT NULL);
CREATE INDEX voter_participant ON voter_sessions(participant_id);
CREATE TABLE audit(id INTEGER PRIMARY KEY, action TEXT NOT NULL, subject TEXT, occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER offerings_no_delete BEFORE DELETE ON offerings BEGIN SELECT RAISE(ABORT,'Las seis mesas son obligatorias'); END;
CREATE TRIGGER offerings_no_insert BEFORE INSERT ON offerings WHEN (SELECT COUNT(*) FROM offerings)>=6 BEGIN SELECT RAISE(ABORT,'Exactamente seis mesas'); END;
CREATE TRIGGER offerings_locked BEFORE UPDATE ON offerings WHEN (SELECT status FROM election)!='draft' BEGIN SELECT RAISE(ABORT,'Concurso iniciado'); END;
CREATE TRIGGER participant_no_insert BEFORE INSERT ON participants WHEN (SELECT status FROM election)!='draft' BEGIN SELECT RAISE(ABORT,'Concurso iniciado'); END;
CREATE TRIGGER participant_no_delete BEFORE DELETE ON participants BEGIN SELECT RAISE(ABORT,'No se eliminan participantes'); END;
CREATE TRIGGER participant_identity_locked BEFORE UPDATE OF id,name,email,table_id ON participants WHEN (SELECT status FROM election)!='draft' BEGIN SELECT RAISE(ABORT,'Concurso iniciado'); END;
CREATE TRIGGER participant_vote_final BEFORE UPDATE OF voted ON participants WHEN OLD.voted=1 BEGIN SELECT RAISE(ABORT,'Voto definitivo'); END;
CREATE TRIGGER ballot_no_update BEFORE UPDATE ON ballots BEGIN SELECT RAISE(ABORT,'Voto definitivo'); END;
CREATE TRIGGER ballot_no_delete BEFORE DELETE ON ballots BEGIN SELECT RAISE(ABORT,'Voto definitivo'); END;
CREATE TRIGGER ballot_open BEFORE INSERT ON ballots WHEN (SELECT status FROM election)!='open' BEGIN SELECT RAISE(ABORT,'Votacion cerrada'); END;
CREATE TRIGGER election_one_way BEFORE UPDATE OF status ON election WHEN NOT ((OLD.status='draft' AND NEW.status='open') OR (OLD.status='open' AND NEW.status='closed')) BEGIN SELECT RAISE(ABORT,'Transicion invalida'); END;
CREATE TRIGGER participant_cast_open BEFORE UPDATE OF voted ON participants WHEN OLD.voted=0 AND NEW.voted=1 AND ((SELECT status FROM election)!='open' OR OLD.code_hash IS NULL) BEGIN SELECT RAISE(ABORT,'Participante no habilitado'); END;
CREATE TRIGGER ballot_count_guard BEFORE INSERT ON ballots WHEN (SELECT COUNT(*) FROM ballots)>=(SELECT COALESCE(SUM(voted),0) FROM participants) BEGIN SELECT RAISE(ABORT,'Papeleta sin participacion disponible'); END;
INSERT INTO schema_migrations VALUES(1);
