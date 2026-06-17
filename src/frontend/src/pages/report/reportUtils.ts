// Helpers for building ReportTaskLine / ReportArtifactLine without triggering
// `exactOptionalPropertyTypes` errors. The pattern `{ ...obj, field: value || undefined }`
// produces `{ field: undefined }` which is not assignable to `field?: T` under
// exactOptionalPropertyTypes. Instead we build a fresh object and only set the
// key if the value is defined.

import type {
  ArtifactChangeKind,
  ArtifactTag,
  ArtifactType,
  ReportActionItemLine,
  ReportArtifactLine,
  ReportJson,
  ReportTaskLine,
  TaskStatus,
} from '@/types';

export function makeTaskLine(
  task: string,
  status: TaskStatus,
  owner: string,
  note: string,
  finishedOn?: string,
): ReportTaskLine {
  const line: ReportTaskLine = { task, status };
  if (owner) line.owner = owner;
  if (note) line.note = note;
  if (finishedOn) line.finished_on = finishedOn;
  return line;
}

export function makeArtifactLine(
  artifact: string,
  type: string,
  changeKind: string,
  tagsRaw: string,
  note: string,
): ReportArtifactLine {
  const line: ReportArtifactLine = { artifact };
  if (type) line.type = type as ArtifactType;
  if (changeKind) line.change_kind = changeKind as ArtifactChangeKind;
  const tags = tagsRaw
    ? (tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) as ArtifactTag[])
    : undefined;
  if (tags && tags.length > 0) line.tags = tags;
  if (note) line.note = note;
  return line;
}

export function makeActionItemLine(
  text: string,
  owner: string,
  dueDate: string,
  domain?: string,
): ReportActionItemLine {
  const item: ReportActionItemLine = { text };
  if (owner) item.owner = owner;
  if (dueDate) item.due_date = dueDate;
  if (domain) item.domain = domain;
  return item;
}

/** Return a new ReportJson with an optional string field set or removed. */
export function setOptionalString(
  report: ReportJson,
  field: 'discussion' | 'issues',
  value: string,
): ReportJson {
  const next = { ...report };
  if (value) {
    next[field] = value;
  } else {
    delete next[field];
  }
  return next;
}

/** Return a new ReportJson with participants set or removed. */
export function setParticipants(report: ReportJson, raw: string): ReportJson {
  const next = { ...report };
  const parts = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  if (parts && parts.length > 0) {
    next.participants = parts;
  } else {
    delete next.participants;
  }
  return next;
}
