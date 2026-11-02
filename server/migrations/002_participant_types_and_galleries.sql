-- Se aplica sin FK durante la reconstrucción, con foreign_key_check antes de COMMIT.
DROP TRIGGER ballot_count_guard;
CREATE TABLE participants_v2(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
 table_id INTEGER REFERENCES offerings(id),
 type TEXT NOT NULL DEFAULT 'integrante' CHECK(type IN ('integrante','solo_votante')),
 code_hash TEXT UNIQUE, issued INTEGER NOT NULL DEFAULT 0 CHECK(issued IN(0,1)),
 voted INTEGER NOT NULL DEFAULT 0 CHECK(voted IN(0,1)),
 CHECK(voted=0 OR code_hash IS NULL),
 CHECK((type='integrante' AND table_id IS NOT NULL) OR (type='solo_votante' AND table_id IS NULL))
);
INSERT INTO participants_v2(id,name,email,table_id,type,code_hash,issued,voted)
 SELECT id,name,email,table_id,'integrante',code_hash,issued,voted FROM participants;
DROP TABLE participants;
ALTER TABLE participants_v2 RENAME TO participants;
CREATE TRIGGER participant_no_insert BEFORE INSERT ON participants WHEN (SELECT status FROM election)!='draft' BEGIN SELECT RAISE(ABORT,'Concurso iniciado'); END;
CREATE TRIGGER participant_no_delete BEFORE DELETE ON participants BEGIN SELECT RAISE(ABORT,'No se eliminan participantes'); END;
CREATE TRIGGER participant_identity_locked BEFORE UPDATE OF id,name,email,table_id,type ON participants WHEN (SELECT status FROM election)!='draft' BEGIN SELECT RAISE(ABORT,'Concurso iniciado'); END;
CREATE TRIGGER participant_vote_final BEFORE UPDATE OF voted ON participants WHEN OLD.voted=1 BEGIN SELECT RAISE(ABORT,'Voto definitivo'); END;
CREATE TRIGGER participant_cast_open BEFORE UPDATE OF voted ON participants WHEN OLD.voted=0 AND NEW.voted=1 AND ((SELECT status FROM election)!='open' OR OLD.code_hash IS NULL) BEGIN SELECT RAISE(ABORT,'Participante no habilitado'); END;
CREATE TRIGGER ballot_count_guard BEFORE INSERT ON ballots WHEN (SELECT COUNT(*) FROM ballots)>=(SELECT COALESCE(SUM(voted),0) FROM participants) BEGIN SELECT RAISE(ABORT,'Papeleta sin participacion disponible'); END;
ALTER TABLE offerings ADD COLUMN gallery_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE offering_photos(
 id TEXT PRIMARY KEY, offering_id INTEGER NOT NULL REFERENCES offerings(id),
 data BLOB NOT NULL, thumbnail BLOB NOT NULL, mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 width INTEGER, height INTEGER,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
 is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
 UNIQUE(offering_id,position)
);
CREATE UNIQUE INDEX photo_primary ON offering_photos(offering_id) WHERE is_primary=1;
-- Copia exacta de la foto existente: nunca se descarta ni se recodifica durante la migración.
INSERT INTO offering_photos(id,offering_id,data,thumbnail,mime,position,is_primary)
 SELECT lower(hex(randomblob(16))),id,photo,photo,mime,0,1 FROM offerings WHERE photo IS NOT NULL;
CREATE TRIGGER photos_max_five BEFORE INSERT ON offering_photos WHEN (SELECT COUNT(*) FROM offering_photos WHERE offering_id=NEW.offering_id)>=5 BEGIN SELECT RAISE(ABORT,'Maximo cinco fotos por mesa'); END;
CREATE TRIGGER photos_insert_locked BEFORE INSERT ON offering_photos WHEN (SELECT status FROM election)!='draft' BEGIN SELECT RAISE(ABORT,'Concurso iniciado'); END;
CREATE TRIGGER photos_update_locked BEFORE UPDATE ON offering_photos WHEN (SELECT status FROM election)!='draft' BEGIN SELECT RAISE(ABORT,'Concurso iniciado'); END;
CREATE TRIGGER photos_delete_locked BEFORE DELETE ON offering_photos WHEN (SELECT status FROM election)!='draft' BEGIN SELECT RAISE(ABORT,'Concurso iniciado'); END;
INSERT INTO schema_migrations VALUES(2);
