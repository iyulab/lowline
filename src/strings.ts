// Every user-facing string lives here, so a change of UI language touches one file.
import type { TemplateProblem } from './documents.js'
import type { Abstention, FieldCurve } from './projection.js'
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
  noVault: '볼트는 서식과 문서를 담는 폴더입니다. 모든 것이 그 폴더의 파일로 남습니다.',
  newVault: '새 볼트 만들기',
  newVaultTitle: '새 볼트로 쓸 빈 폴더 선택',
  newVaultNotEmpty: '빈 폴더를 고르세요. 이미 파일이 있는 폴더는 "기존 폴더 열기"로 엽니다.',
  openFolder: '기존 폴더 열기',
  sampleTemplateName: '문의 접수',
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
  optionsOf: (label: string) => `${label} 선택지`,
  fieldsTitle: '칸',
  fieldsHelp: '체크한 칸은 판단 칸 — 확정한 문서에서 배워 값을 제안받습니다(서식 앞부분 lowline.suggest에 적힘). 선택지는 쉼표로 나눠 적으면 원문의 그 칸에 그대로 적힙니다. "이름 바꾸기"는 칸이 보이는 이름(label)만 바꿉니다 — 문서의 값과 배운 것은 칸 이름에 붙어 있어 그대로 이어집니다.',
  fieldsNone: '이 서식에는 칸이 없습니다.',
  templateProblemsTitle: '서식 원문의 문제',
  templateProblem: (p: TemplateProblem) =>
    p.kind === 'front-matter'
      ? `서식 앞부분(front matter)을 읽을 수 없어 저장하지 않습니다 — ${p.detail}`
      : p.kind === 'duplicate-field'
        ? `칸 이름 "${p.name}"이(가) 두 번 이상 쓰였습니다${p.lines.length ? `(다시 쓰인 줄: ${p.lines.join(', ')})` : ''}. 문서에는 이 이름으로 값이 하나만 남아 두 칸이 같은 값을 가집니다.`
        : p.kind === 'unknown-condition'
          ? `칸 "${p.field}"의 조건이 이 서식에 없는 칸 "${p.name}"을(를) 가리킵니다. 값이 들어올 수 없어 늘 같게 판정됩니다 — visible-if라면 칸이 계속 숨습니다.`
          : p.kind === 'shared-id'
            ? `다른 서식 파일(${p.names.join(', ')})도 id "${p.id}"를 씁니다. 판이 달라도 같은 서식이라 볼트는 판이 높은 파일을 서식으로 읽고, 다른 파일은 서식으로 쓰지 않습니다 — 판은 파일 하나 안에서 올리세요.`
          : p.kind === 'stray-values'
            ? `문서 ${p.count}건에 칸 "${p.name}"의 값이 있는데 이 서식에는 그 칸이 없습니다. 값은 파일에 남지만 표와 제안에서 빠집니다 — 보이는 이름만 바꾸려면 칸 이름은 두고 칸 목록의 "이름 바꾸기"를 쓰세요.`
            : `lowline.suggest의 "${p.name}"은(는) 이 서식의 칸이 아니라 제안이 켜지지 않습니다.`,
  judgmentFields: (labels: string[]) => `제안 받는 칸: ${labels.join(', ')}`,
  judgmentAbstained: (reason: Abstention | null | undefined, learned: number) =>
    reason === 'no-history' || (!reason && learned === 0)
      ? `확정한 문서가 아직 없어 제안하지 않습니다. 저장할 때마다 배웁니다.`
      : reason === 'below-target'
        ? `확정한 ${learned}건을 순서대로 다시 물어도 목표만큼 맞히지 못해, 이 칸은 아직 비슷한 기록으로 제안하지 않습니다.`
        : `확정한 ${learned}건 중 비슷한 기록이 없어 제안하지 않습니다.`,
  // Asked after each pause in typing, so the next pause asks again.
  judgmentUnavailable: '이 칸의 제안을 준비하지 못했습니다 — 입력을 이어 가면 다시 묻습니다.',
  // The sidecar did not start: filling in and saving do not need it.
  suggestionsUnavailable: '제안을 준비하지 못했습니다. 입력과 저장은 그대로 됩니다 — 앱을 다시 열면 다시 시도합니다.',
  newDocument: '새 문서',
  noDocuments: '문서가 없습니다.',
  documentsFilter: '이름이나 칸 값으로 찾기',
  documentsNoMatch: '이름이나 칸 값이 맞는 문서가 없습니다.',
  /** While the sidecar looks through the documents' values (the first index of a large vault takes a while). */
  documentsSearching: '칸 값에서 찾는 중…',
  documentsSearchFailed: '칸 값에서는 찾지 못해 이름으로만 찾았습니다.',
  similarCases: '비슷한 사례',
  similarLoading: '찾는 중…',
  similarNone: '이 서식에 비슷한 문서가 없습니다.',
  similarFailed: '비슷한 문서를 찾지 못했습니다. 다시 펼치면 다시 찾습니다.',
  conflictCopyOf: (original: string) => `충돌 사본 — 원본: ${original}`,
  hasConflictCopy: '충돌 사본 있음',
  conflictedOriginal: '다른 기기에서 고친 사본이 있습니다. 하나로 정할 때까지 제안이 이 문서에서 배우지 않습니다. 사본을 열어 남길 쪽을 고르세요.',
  conflictCopy: (original: string) =>
    `동기화 도구가 남긴 충돌 사본입니다(원본: ${original}). 이 사본을 남기면 원본은 휴지통으로 가고 이 사본이 원본 이름을 받습니다. 원본을 남기려면 이 사본을 지우세요.`,
  conflictedTemplate: '다른 기기에서 고친 사본이 있습니다. 사본을 열어 남길 쪽을 고르세요.',
  viewCopy: (name?: string) => (name === undefined ? '사본 보기' : `사본 보기: ${name}`),
  keepCopy: '이 사본을 남기기',
  keepCopyHeading: '이 사본을 남길까요?',
  keepCopyBody: (original: string) =>
    `원본(${original})을 휴지통으로 옮기고, 이 사본이 그 이름을 받습니다. 휴지통에서 원본을 되살릴 수 있습니다.`,
  keepCopyConfirm: '사본 남기기',
  keepCopyNotTrashedBody: '이 위치에는 휴지통이 없을 수 있습니다. 두 파일 모두 그대로 있습니다. 원본을 영구히 지우면 되살릴 수 없습니다.',
  keepCopyPermanently: '원본 영구히 지우기',
  keptCopy: (permanently: boolean) => (permanently ? '사본을 남겼습니다. 원본은 지웠습니다.' : '사본을 남겼습니다. 원본은 휴지통에 있습니다.'),
  keptCopyNameTaken: (permanently: boolean) =>
    `원본 이름의 파일이 다시 생겨 이 사본에 그 이름을 줄 수 없습니다. ${permanently ? '원본은 지웠고' : '원본은 휴지통에 있고'} 이 사본은 그대로입니다.`,
  keptOriginal: (permanently: boolean) => (permanently ? '사본을 지우고 원본을 남겼습니다.' : '사본을 휴지통으로 옮기고 원본을 남겼습니다.'),
  documentFrom: (name: string) => `서식: ${name}`,
  cancel: '취소',
  rename: '이름 바꾸기',
  renameConfirm: '바꾸기',
  newName: '새 이름',
  renamed: '이름을 바꿨습니다',
  delete: '지우기',
  deleteConfirm: '휴지통으로 옮기기',
  deleteDocumentHeading: '이 문서를 지울까요?',
  deleteDocumentBody: (unsaved: boolean) =>
    `파일을 휴지통으로 옮깁니다. 휴지통에서 되살릴 수 있습니다. 이 문서의 확정 값은 더 이상 제안에 쓰이지 않습니다.${unsaved ? ' 저장하지 않은 편집은 함께 사라집니다.' : ''}`,
  deleteTemplateHeading: '이 서식을 지울까요?',
  deleteTemplateBody: (unsaved: boolean) =>
    `파일을 휴지통으로 옮깁니다. 휴지통에서 되살릴 수 있습니다. 이 서식으로 쓴 문서는 지우지 않습니다 — "서식 없는 문서"에 남습니다.${unsaved ? ' 저장하지 않은 편집은 함께 사라집니다.' : ''}`,
  deleteCopyHeading: '이 사본을 지울까요?',
  deleteCopyBody: (unsaved: boolean) =>
    `사본을 휴지통으로 옮기고 원본을 남깁니다. 휴지통에서 되살릴 수 있습니다.${unsaved ? ' 저장하지 않은 편집은 함께 사라집니다.' : ''}`,
  notTrashedHeading: '휴지통으로 옮기지 못했습니다',
  notTrashedBody: '이 위치에는 휴지통이 없을 수 있습니다. 파일은 그대로 있습니다. 영구히 지우면 되살릴 수 없습니다.',
  deletePermanently: '영구히 지우기',
  trashed: '휴지통으로 옮겼습니다',
  removed: '지웠습니다',
  templateDeleted: (permanently: boolean, orphans: boolean) =>
    `${permanently ? '서식을 지웠습니다.' : '서식을 휴지통으로 옮겼습니다.'} 그 서식으로 쓴 문서는 지우지 않았습니다${orphans ? ' — "서식 없는 문서"에 있습니다' : ''}.`,
  nameTaken: '같은 이름의 문서가 이미 있습니다.',
  templateNameTaken: '같은 이름의 서식이 이미 있습니다.',
  nameInvalid: '이름이 비었거나 파일 이름에 쓸 수 없는 글자(\\ / :* ? " < > |)가 있습니다.',
  import: '가져오기',
  importTitle: '기존 기록 가져오기',
  importPaste: '복사한 행을 여기에 붙여 넣으세요',
  importHint: '스프레드시트에서 첫 행(칸 이름)부터 기록 행까지 복사합니다. 칸 이름이 서식의 칸과 같은 열만 가져옵니다.',
  importColumn: '붙여 넣은 열',
  importField: '채울 칸',
  importUnmatched: '가져오지 않음',
  importUseDate: '기록한 날짜 — 파일 이름의 날짜',
  importUseName: '번호 — 파일 이름 앞에',
  importUseOf: (heading: string) => `${heading} 열을 어디에 쓸지`,
  importSummary: (documents: number, skipped: number) =>
    skipped ? `문서 ${documents}건을 만듭니다 · 빈 행 ${skipped}개는 건너뜁니다` : `문서 ${documents}건을 만듭니다`,
  importProblems: (n: number) => `선택지와 맞지 않는 값 ${n}개 — 적힌 그대로 가져옵니다`,
  importProblem: (row: number, field: string, value: string) => `${row}행 ${field}: ${value}`,
  importConfirm: (n: number) => `${n}건 가져오기`,
  importing: (done: number, total: number) => `가져오는 중 ${done} / ${total}`,
  imported: (n: number) => `${n}건을 가져왔습니다`,
  importStopped: (created: number, message: string) => `${created}건을 만든 뒤 멈췄습니다: ${message}`,
  tableExport: 'CSV로 내보내기',
  tableExportDocument: '문서',
  tableExportFilter: 'CSV (쉼표로 구분)',
  tableExported: (file: string) => `${file}(으)로 내보냈습니다`,
  tableEmpty: '이 서식으로 만든 문서가 없습니다.',
  tableCount: (n: number) => `문서 ${n}건`,
  tableMatching: (n: number) => `조건에 맞는 문서 ${n}건`,
  tableNoMatch: '조건에 맞는 문서가 없습니다.',
  tableFilters: '표 거르기',
  tableFilterName: '이름에 든 글자',
  tableFilterAny: (label: string) => `${label}: 모두`,
  tableFilterField: '글자를 찾을 칸',
  tableFilterText: '칸에 든 글자',
  tableFilterAtLeast: (label: string) => `${label} 이상`,
  tableFilterAtMost: (label: string) => `${label} 이하`,
  tableSkipped: (n: number) => `표에 넣지 못한 문서 ${n}건`,
  hostStarting: '표를 준비하고 있습니다…',
  learningEmpty: '제안을 받는 판단 칸이 아직 없습니다. 서식에서 판단 칸을 정하면 여기서 곡선이 자랍니다.',
  learningUndecided: '아직 결정된 제안이 없습니다 — 제안을 수락·교정·거절하며 저장하면 곡선이 자랍니다.',
  learningNoReplay: (why: FieldCurve['whyNoReplay']) =>
    why === 'few'
      ? '기록이 아직 적어 다시 물어보지 않았습니다 — 확정한 문서가 늘면 저장된 기록을 순서대로 다시 물어 제안 기준을 고릅니다.'
      : why === 'below-target'
        ? '저장된 기록을 순서대로 다시 물어도 목표만큼 맞히는 기준이 없어, 이 칸은 아직 비슷한 기록으로 제안하지 않습니다.'
        : '저장된 기록을 순서대로 다시 물어 제안 기준을 고르는 중입니다 — 끝나면 이 화면을 다시 열어 보세요.',
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
  writtenWith: (version: string, now: string) => `이 문서는 서식 ${version}판으로 쓰였습니다(지금 ${now}판). 값과 배운 것은 이 서식의 것으로 이어집니다 — 본문도 지금 판으로 옮길 수 있습니다.`,
  reviseDocument: '지금 판으로 옮기기',
  revised: '지금 판으로 옮겼습니다',
  suggestionSource: (name: string) => `제안 · 비슷한 기록: ${name}`,
  /** Each similar record with the value it confirmed: the evidence behind one suggestion, other values included. */
  suggestionSources: (cases: { name: string; value: string }[]) =>
    `제안 · 비슷한 기록 ${cases.length}건: ${cases.map((c) => `${c.name}(${c.value})`).join(' · ')}`,
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
/**
 * The sample a new vault starts with: an intake form with one judgment field turned on, so saving a
 * few requests shows what suggestions are. It holds no documents — suggestions learn only from what
 * a person confirms. Provisional: which domains the app's samples come from is still open (B-09).
 */
export function sampleTemplate(id: string): string {
  return `---
id: ${id}
version: 1
lowline:
  suggest: [담당]
---
# ${strings.sampleTemplateName}

요청: ___@요청

@부서: [select options="영업,개발,인사,총무"]

@담당: [select options="장비,계정,급여,시설"]

@메모: [textarea rows=3]
`
}

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
