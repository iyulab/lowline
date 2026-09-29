// Every user-facing string lives here, so a change of UI language touches one file.
export const strings = {
  appName: 'Lowline',
  navLabel: '탐색',
  navTemplates: '서식',
  navDocuments: '문서',
  navTable: '표',
  navLearning: '학습',
  orphanDocuments: '서식 없는 문서',
  toggleSidebar: '사이드바 접기/펼치기',
  openVault: '볼트 열기',
  openVaultTitle: '볼트로 쓸 폴더 선택',
  tagline: '서식을 노트처럼 쓰는 로컬 에디터',
  noVault: '볼트를 열면 서식과 문서가 여기에 보입니다.',
  save: '저장',
  saved: '저장했습니다',
  reloadedOutside: '밖에서 바뀌어 다시 읽었습니다',
  changedOutsideDirty: '이 파일이 밖에서 바뀌었습니다. 저장하면 그 변경을 덮어쓰고, 다시 읽으면 내 편집을 버립니다.',
  readOutside: '밖의 내용으로 다시 읽기',
  unsavedHeading: '저장하지 않은 편집이 있습니다',
  unsavedBody: '지금 편집을 버리면 되돌릴 수 없습니다. 계속 편집해서 저장할 수도 있습니다.',
  unsavedDiscard: '편집 버리기',
  unsavedKeep: '계속 편집',
  removedOutside: '이 파일이 밖에서 지워졌습니다. 저장하면 다시 만듭니다.',
  makeTemplate: '새 서식 만들기',
  newTemplateName: '새 서식',
  noTemplates: '서식이 없습니다. 새 서식을 만드세요.',
  templateSource: '서식 원문',
  preview: '미리보기',
  optionsTitle: '선택지',
  optionsHelp: '쉼표로 나눠 적습니다. 서식 원문의 그 칸에 그대로 적힙니다.',
  optionsOf: (label: string) => `${label} 선택지`,
  judgmentTitle: '판단 칸',
  judgmentHelp: '확정한 문서에서 배워 값을 제안받을 칸입니다. 저장하면 서식 파일의 앞부분(lowline.suggest)에 적힙니다.',
  judgmentNone: '이 서식에는 칸이 없습니다.',
  judgmentFields: (labels: string[]) => `제안 받는 칸: ${labels.join(', ')}`,
  judgmentAbstained: (learned: number) =>
    learned === 0
      ? `확정한 문서가 아직 없어 제안하지 않습니다. 저장할 때마다 배웁니다.`
      : `확정한 ${learned}건 중 비슷한 기록이 없어 제안하지 않습니다.`,
  newDocument: '새 문서',
  noDocuments: '문서가 없습니다.',
  conflictCopyOf: (original: string) => `충돌 사본 — 원본: ${original}`,
  hasConflictCopy: '충돌 사본 있음',
  conflictedOriginal: '다른 기기에서 고친 사본이 있습니다. 하나로 정할 때까지 제안이 이 문서에서 배우지 않습니다. 남길 쪽을 정해 다른 파일을 지우세요.',
  conflictCopy: (original: string) => `동기화 도구가 남긴 충돌 사본입니다(원본: ${original}). 남길 쪽을 정해 다른 파일을 지우세요.`,
  conflictedTemplate: '다른 기기에서 고친 사본이 있습니다. 남길 쪽을 정해 다른 파일을 지우세요.',
  documentFrom: (name: string) => `서식: ${name}`,
  cancel: '취소',
  import: '가져오기',
  importTitle: '기존 기록 가져오기',
  importPaste: '복사한 행을 여기에 붙여 넣으세요',
  importHint: '스프레드시트에서 첫 행(칸 이름)부터 기록 행까지 복사합니다. 칸 이름이 서식의 칸과 같은 열만 가져옵니다.',
  importColumn: '붙여 넣은 열',
  importField: '채울 칸',
  importUnmatched: '가져오지 않음',
  importSummary: (documents: number, skipped: number) =>
    skipped ? `문서 ${documents}건을 만듭니다 · 빈 행 ${skipped}개는 건너뜁니다` : `문서 ${documents}건을 만듭니다`,
  importProblems: (n: number) => `선택지와 맞지 않는 값 ${n}개 — 적힌 그대로 가져옵니다`,
  importProblem: (row: number, field: string, value: string) => `${row}행 ${field}: ${value}`,
  importConfirm: (n: number) => `${n}건 가져오기`,
  importing: (done: number, total: number) => `가져오는 중 ${done} / ${total}`,
  imported: (n: number) => `${n}건을 가져왔습니다`,
  importStopped: (created: number, message: string) => `${created}건을 만든 뒤 멈췄습니다: ${message}`,
  tableEmpty: '이 서식으로 만든 문서가 없습니다.',
  tableCount: (n: number) => `문서 ${n}건`,
  tableSkipped: (n: number) => `표에 넣지 못한 문서 ${n}건`,
  hostStarting: '표를 준비하고 있습니다…',
  learningEmpty: '아직 결정된 제안이 없습니다. 판단 칸의 제안을 수락·교정·거절하며 저장하면 여기서 곡선이 자랍니다.',
  learningTitle: (template: string, field: string) => `${template} · ${field}`,
  // Counted over fields that got a suggestion; a field the memory left blank is not in it.
  learningRate: (rate: number, of: number) => `제안이 나온 최근 ${of}건 중 맞음 ${Math.round(rate * 100)}%`,
  // Before the window is full a share reads as more than it is: one right answer is not "100%".
  learningFew: (right: number, of: number) => `제안이 나온 ${of}건 중 ${right}건 맞음 — 아직 비율을 말하기엔 적습니다`,
  learningFirst: (rate: number, of: number) => `처음 ${of}건 ${Math.round(rate * 100)}%`,
  learningCounts: (accepted: number, corrected: number, rejected: number) => `수락 ${accepted} · 교정 ${corrected} · 거절 ${rejected}`,
  // The replay also counts the fields memory left blank, which the curve does not.
  learningReplay: (answerRate: number, precision: number, lookups: number) =>
    `저장된 ${lookups}건을 순서대로 다시 물으면 ${Math.round(answerRate * 100)}%에 제안, 그중 ${Math.round(precision * 100)}% 맞음`,
  learningChart: (field: string) => `${field} — 제안이 나온 칸 중 맞은 비율, 결정 순서대로`,
  learningPoint: (n: number, rate: number) => `${n}번째 결정 뒤 ${Math.round(rate * 100)}%`,
  learningTable: '표로 보기',
  countsTitle: '주별 집계 (개수만)',
  countsHelp:
    '제안이 나아지는지 연구하는 쪽에 직접 건넬 수 있는 집계입니다. 서식과 칸은 번호로만 적고, 문서 내용·값·이름·경로는 담지 않습니다. 보인 제안 수(presented)는 이 기기에서 보인 것만, 결정은 볼트를 함께 쓰는 모든 기기의 것을 셉니다.',
  countsForm: (n: number, name: string, fields: string[]) => `서식 ${n} = ${name} (칸 ${fields.map((f, i) => `${i + 1} = ${f}`).join(', ')}) — 이 대응은 복사되지 않습니다`,
  countsCopy: '집계 복사',
  countsCopied: '복사했습니다',
  countsCopyFailed: '복사하지 못했습니다. 위 글을 선택해 복사하세요.',
  learningN: '결정',
  learningAt: '시각',
  learningShare: '제안이 나온 칸 중 맞은 비율',
  suggestion: '제안',
  suggestionSource: (name: string) => `제안 · 비슷한 기록: ${name}`,
  suggestionKey: (value: string) => `제안 · 함께 확정된 값: ${value}`,
  reject: '거절',
  hostFailed: (message: string) => `표를 만드는 도우미가 시작되지 않았습니다: ${message}`,
  errors: {
    'missing-id': '서식 front matter에 id가 없습니다.',
    'missing-version': '서식 front matter에 version이 없습니다.',
    'invalid-id': '서식 id에는 공백과 @를 쓸 수 없습니다.',
    'reserved-field': '칸 이름으로 template과 lowline은 쓸 수 없습니다. 문서가 이 이름을 스스로 씁니다.',
    'template-not-found': (ref: string) => `이 문서의 서식(${ref})을 볼트에서 찾지 못했습니다.`,
    'already-exists': '같은 이름의 파일이 이미 있습니다.',
    unknown: (message: string) => `작업을 끝내지 못했습니다: ${message}`,
  },
} as const

/**
 * A starter template: its front matter names it, the body is plain Formdown. Field names are
 * Korean so the labels and the document's front matter keys read in the UI's language.
 */
export function starterTemplate(id: string): string {
  return `---
id: ${id}
version: 1
---
# ${strings.newTemplateName}

제목: ___@제목

@상태: [select options="열림,진행,닫힘"]

@메모: [textarea rows=4]
`
}
