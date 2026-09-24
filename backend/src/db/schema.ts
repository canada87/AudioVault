import { sqliteTable, integer, text, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const records = sqliteTable('records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  original_name: text('original_name').notNull(),
  display_name: text('display_name'),
  recorded_at: integer('recorded_at').notNull(),
  file_path: text('file_path').notNull(),
  audio_deleted: integer('audio_deleted').default(0).notNull(),
  transcription: text('transcription'),
  summary: text('summary'),
  notes: text('notes'),
  status: text('status', {
    enum: ['pending', 'transcribing', 'transcribed', 'processing', 'done', 'error'],
  })
    .default('pending')
    .notNull(),
  transcribed_at: integer('transcribed_at'),
  processed_at: integer('processed_at'),
  duration_seconds: integer('duration_seconds'),
  created_at: integer('created_at')
    .default(sql`(unixepoch())`)
    .notNull(),
  updated_at: integer('updated_at')
    .default(sql`(unixepoch())`)
    .notNull(),
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').unique().notNull(),
  parent_id: integer('parent_id').references((): AnySQLiteColumn => tags.id, { onDelete: 'set null' }),
});

export const recordTags = sqliteTable(
  'record_tags',
  {
    record_id: integer('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    tag_id: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.record_id, t.tag_id] }),
  }),
);

export const processingLog = sqliteTable('processing_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  record_id: integer('record_id')
    .notNull()
    .references(() => records.id, { onDelete: 'cascade' }),
  action: text('action', { enum: ['transcription', 'summary'] }).notNull(),
  triggered_by: text('triggered_by', { enum: ['scheduler', 'manual'] }).notNull(),
  status: text('status', { enum: ['success', 'error'] }).notNull(),
  error_msg: text('error_msg'),
  created_at: integer('created_at')
    .default(sql`(unixepoch())`)
    .notNull(),
});

export const dailyLimits = sqliteTable('daily_limits', {
  date: text('date').primaryKey(),
  llm_count: integer('llm_count').default(0).notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  tag_mode: text('tag_mode', { enum: ['or', 'and'] }).default('or').notNull(),
  report: text('report'),
  report_period_start: integer('report_period_start'),
  report_period_end: integer('report_period_end'),
  last_generated_at: integer('last_generated_at'),
  last_error: text('last_error'),
  created_at: integer('created_at')
    .default(sql`(unixepoch())`)
    .notNull(),
  updated_at: integer('updated_at')
    .default(sql`(unixepoch())`)
    .notNull(),
});

export const projectTags = sqliteTable(
  'project_tags',
  {
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tag_id: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.project_id, t.tag_id] }),
  }),
);

export const projectRecords = sqliteTable(
  'project_records',
  {
    project_id: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    record_id: integer('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    state: text('state', { enum: ['included', 'excluded'] }).notNull(),
    updated_at: integer('updated_at')
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.project_id, t.record_id] }),
  }),
);

export type Record = typeof records.$inferSelect;
export type NewRecord = typeof records.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type RecordTag = typeof recordTags.$inferSelect;
export type ProcessingLog = typeof processingLog.$inferSelect;
export type DailyLimit = typeof dailyLimits.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectTag = typeof projectTags.$inferSelect;
export type ProjectRecord = typeof projectRecords.$inferSelect;

export type RecordStatus = 'pending' | 'transcribing' | 'transcribed' | 'processing' | 'done' | 'error';
export type ProjectTagMode = 'or' | 'and';
export type ProjectRecordState = 'included' | 'excluded';
