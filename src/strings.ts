// Every user-facing string lives here, so a change of UI language touches one file.
export const strings = {
  appName: 'Lowline',
  navLabel: '탐색',
  navTemplates: '서식',
  navDocuments: '문서',
  navTable: '표',
  navLearning: '학습',
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
  removedOutside: '이 파일이 밖에서 지워졌습니다. 저장하면 다시 만듭니다.',
  newTemplate: '새 서식',
  newTemplateName: '새 서식',
  noTemplates: '서식이 없습니다. 새 서식을 만드세요.',
  pickTemplate: '서식을 고르세요',
  templateSource: '서식 원문',
  preview: '미리보기',
  newDocument: '새 문서',
  noDocuments: '문서가 없습니다.',
  documentFrom: (name: string) => `서식: ${name}`,
  cancel: '취소',
  import: '가져오기',
  importTitle: '기존 기록 가져오기',
  importTemplate: '어느 서식의 기록인가요',
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
  tableTemplate: '서식',
  tableEmpty: '이 서식으로 만든 문서가 없습니다.',
  tableCount: (n: number) => `문서 ${n}건`,
  tableSkipped: (n: number) => `표에 넣지 못한 문서 ${n}건`,
  openDocument: '문서 열기',
  hostStarting: '표를 준비하고 있습니다…',
  learningEmpty: '아직 결정된 제안이 없습니다. 판단 칸의 제안을 수락·교정·거절하며 저장하면 여기서 곡선이 자랍니다.',
  learningTitle: (template: string, field: string) => `${template} · ${field}`,
  learningRate: (rate: number, of: number) => `최근 ${of}건 중 제안이 맞음 ${Math.round(rate * 100)}%`,
  learningFirst: (rate: number, of: number) => `처음 ${of}건 ${Math.round(rate * 100)}%`,
  learningCounts: (accepted: number, corrected: number, rejected: number) => `수락 ${accepted} · 교정 ${corrected} · 거절 ${rejected}`,
  learningChart: (field: string) => `${field} 제안이 맞은 비율, 결정 순서대로`,
  learningPoint: (n: number, rate: number) => `${n}번째 결정 뒤 ${Math.round(rate * 100)}%`,
  learningTable: '표로 보기',
  learningN: '결정',
  learningAt: '시각',
  learningShare: '맞은 비율',
  suggestionFor: (label: string) => `${label} 제안`,
  suggestionSource: (name: string) => `비슷한 기록: ${name}`,
  accept: '수락',
  reject: '거절',
  hostFailed: (message: string) => `표를 만드는 도우미가 시작되지 않았습니다: ${message}`,
  errors: {
    'missing-id': '서식 front matter에 id가 없습니다.',
    'missing-version': '서식 front matter에 version이 없습니다.',
    'invalid-id': '서식 id에는 공백과 @를 쓸 수 없습니다.',
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
