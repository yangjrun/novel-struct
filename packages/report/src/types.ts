import type { ChapterKind } from '@novelstruct/core';

export interface DialogueStateCounts {
  /** Speaker resolved to an entity. */
  readonly resolved: number;
  /** Speaker named in the text but not matched to an entity. */
  readonly surfaceOnly: number;
  /** No attributor could name a speaker. */
  readonly unknown: number;
}

export interface ReportChapter {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly kind: ChapterKind;
  readonly charCount: number;
  /** True when the structure pass has written segments for this chapter. */
  readonly parsed: boolean;
  readonly narrationChars: number;
  readonly spokenChars: number;
  readonly dialogue: DialogueStateCounts;
  /** entityId -> spoken segments attributed to that entity in this chapter */
  readonly dialogueBySpeaker: Readonly<Record<string, number>>;
  /** entityId -> mention evidence rows in this chapter */
  readonly mentionsByEntity: Readonly<Record<string, number>>;
}

export interface ReportCharacter {
  readonly id: string;
  readonly name: string;
  readonly dialogueCount: number;
  readonly mentionCount: number;
}

/** Everything the report renderer needs; produced by `aggregateReport`, consumed by `renderReport`. */
export interface ReportData {
  readonly bookTitle: string;
  readonly author: string | null;
  readonly editionId: string;
  readonly editionLabel: string;
  /** ISO 8601 timestamp of generation. */
  readonly generatedAt: string;
  readonly chapters: readonly ReportChapter[];
  readonly characters: readonly ReportCharacter[];
}
