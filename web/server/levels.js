/**
 * Chapter loading + seeding.
 *
 * The per-chapter JSON produced by the annotation pipeline (shared/levels/*.json,
 * mirrored to web/data/levels/) is the seed source; MySQL is the runtime source
 * of truth. Boot re-seeds the `levels` / `level_objects` tables so editing a JSON
 * file and restarting is enough to ship a fix - no manual migration.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const OBJECT_FIELDS = ['id', 'name', 'nameEn', 'reason', 'hint', 'bbox', 'confidence'];

export function validateLevel(level, file) {
  const problems = [];
  for (const key of ['id', 'slug', 'title', 'image', 'imageWidth', 'imageHeight', 'objects']) {
    if (level[key] === undefined || level[key] === null || level[key] === '') problems.push(`missing ${key}`);
  }
  if (!Array.isArray(level.objects) || level.objects.length !== 10) {
    problems.push(`expected 10 objects, got ${Array.isArray(level.objects) ? level.objects.length : 'n/a'}`);
  } else {
    level.objects.forEach((object, index) => {
      for (const field of OBJECT_FIELDS) {
        if (object[field] === undefined) problems.push(`objects[${index}] missing ${field}`);
      }
      if (!Array.isArray(object.bbox) || object.bbox.length !== 4 || object.bbox.some((v) => typeof v !== 'number')) {
        problems.push(`objects[${index}] bbox must be four numbers`);
      }
    });
  }
  if (problems.length) {
    throw new Error(`${path.basename(file)} is not a valid level: ${problems.join('; ')}`);
  }
  return level;
}

export async function loadLevelsFromDisk(log = console.log) {
  const dir = config.levelsDir;
  let files;
  try {
    files = (await fs.readdir(dir)).filter((name) => /^level-\d+\.json$/.test(name)).sort();
  } catch (error) {
    throw new Error(`cannot read levels directory ${dir}: ${error.message}`);
  }
  if (!files.length) throw new Error(`no level-*.json files in ${dir}`);

  const levels = [];
  for (const file of files) {
    const full = path.join(dir, file);
    const parsed = JSON.parse(await fs.readFile(full, 'utf8'));
    levels.push(validateLevel(parsed, full));
  }
  levels.sort((a, b) => a.id - b.id);
  log(`[levels] loaded ${levels.length} chapters from ${dir}`);
  return levels;
}

/** Upsert every chapter + its ten objects. Idempotent. */
export async function seedLevels(conn, levels, log = console.log) {
  for (const level of levels) {
    await conn.execute(
      `INSERT INTO levels (id, slug, collection, title, subtitle, era, image, image_width, image_height, object_count, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         slug = VALUES(slug), collection = VALUES(collection), title = VALUES(title),
         subtitle = VALUES(subtitle), era = VALUES(era), image = VALUES(image),
         image_width = VALUES(image_width), image_height = VALUES(image_height),
         object_count = VALUES(object_count), sort_order = VALUES(sort_order)`,
      [
        level.id,
        level.slug,
        level.collection ?? '',
        level.title,
        level.subtitle ?? '',
        level.era ?? '',
        level.image,
        level.imageWidth,
        level.imageHeight,
        level.objects.length,
        level.id,
      ],
    );

    // Objects are replaced wholesale: annotation fixes must not leave stale rows.
    await conn.execute('DELETE FROM level_objects WHERE level_id = ?', [level.id]);
    for (const object of level.objects) {
      const [x, y, w, h] = object.bbox;
      await conn.execute(
        `INSERT INTO level_objects
           (level_id, object_id, name, name_en, reason, hint, bbox_x, bbox_y, bbox_w, bbox_h, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          level.id,
          object.id,
          object.name,
          object.nameEn ?? '',
          object.reason ?? '',
          object.hint ?? '',
          x,
          y,
          w,
          h,
          object.confidence === 'medium' || object.confidence === 'low' ? object.confidence : 'high',
        ],
      );
    }
  }
  log(`[levels] seeded ${levels.length} chapters / ${levels.reduce((n, l) => n + l.objects.length, 0)} objects into MySQL`);
}

export function objectRowToJson(row, { includeSolution = true } = {}) {
  const base = {
    id: row.object_id,
    name: row.name,
    nameEn: row.name_en,
    bbox: [Number(row.bbox_x), Number(row.bbox_y), Number(row.bbox_w), Number(row.bbox_h)],
  };
  if (includeSolution) {
    base.reason = row.reason;
    base.hint = row.hint;
    base.confidence = row.confidence;
  }
  return base;
}
