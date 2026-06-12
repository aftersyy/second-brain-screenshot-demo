import fs from "node:fs";
import path from "node:path";
import { getCardLibraryDir } from "./config.js";
import { getDb, listCards, upsertCard } from "./db.js";
import { importFormalKnowledgeBase, importLegacyCards } from "./legacy-import.js";
import { writeCardMarkdown } from "./markdown.js";

export function migrateLegacyData() {
  const db = getDb();
  const existing = new Map(
    listCards({ limit: 1000 }).map((card) => [`${card.knowledge_date}:${card.title}`, card])
  );
  const imported = [];
  const formalCards = importFormalKnowledgeBase();
  const formalDates = new Set(formalCards.map((card) => card.knowledge_date));
  const fallbackCards = importLegacyCards().filter((card) => !formalDates.has(card.knowledge_date));

  for (const card of [...formalCards, ...fallbackCards]) {
    const existingCard = existing.get(`${card.knowledge_date}:${card.title}`);
    const nextCard = existingCard
      ? {
          ...card,
          card_id: existingCard.card_id,
          created_at: existingCard.created_at
        }
      : card;
    const filePath = writeCardMarkdown({
      ...nextCard,
      created_at: nextCard.created_at || new Date(`${nextCard.knowledge_date}T00:00:00.000Z`).toISOString(),
      updated_at: new Date().toISOString()
    });
    imported.push(upsertCard({ ...nextCard, file_path: filePath }));
  }

  if (formalDates.size) {
    const placeholders = [...formalDates].map(() => "?").join(", ");
    db.prepare(
      `UPDATE cards
       SET status = 'archived'
       WHERE source_type = 'legacy-digest' AND knowledge_date IN (${placeholders})`
    ).run(...formalDates);
  }

  for (const card of listCards({ status: "published", limit: 1000 })) {
    if (card.source_type !== "screenshot") continue;
    if (card.metadata?.review_approved) continue;
    if (card.metadata?.ingest_strategy !== "ocr-heuristic-v1") continue;
    upsertCard({
      ...card,
      status: "archived",
      metadata: {
        ...(card.metadata || {}),
        archived_reason: "superseded_by_legacy_workflow"
      }
    });
  }

  return {
    imported_count: imported.length,
    card_library_dir: getCardLibraryDir(),
    imported
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  console.log(JSON.stringify(migrateLegacyData(), null, 2));
}
