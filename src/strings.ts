// Every user-facing string lives here, so a change of UI language touches one file.
export const strings = {
  appName: 'Lowline',
  navLabel: '탐색',
  navTemplates: '서식',
  navDocuments: '문서',
  toggleSidebar: '사이드바 접기/펼치기',
  openVault: '볼트 열기',
  openVaultTitle: '볼트로 쓸 폴더 선택',
  tagline: '서식을 노트처럼 쓰는 로컬 에디터',
  noVault: '볼트를 열면 서식과 문서가 여기에 보입니다.',
  save: '저장',
  saved: '저장했습니다',
  newTemplate: '새 서식',
  newTemplateName: '새 서식',
  noTemplates: '서식이 없습니다. 새 서식을 만드세요.',
  pickTemplate: '서식을 고르세요',
  templateSource: '서식 원문',
  preview: '미리보기',
  newDocument: '새 문서',
  noDocuments: '문서가 없습니다.',
  documentFrom: (ref: string) => `서식 ${ref}`,
  errors: {
    'missing-id': '서식 front matter에 id가 없습니다.',
    'missing-version': '서식 front matter에 version이 없습니다.',
    'invalid-id': '서식 id에는 공백과 @를 쓸 수 없습니다.',
    'template-not-found': (ref: string) => `이 문서의 서식(${ref})을 볼트에서 찾지 못했습니다.`,
    'already-exists': '같은 이름의 파일이 이미 있습니다.',
    unknown: (message: string) => `작업을 끝내지 못했습니다: ${message}`,
  },
} as const

/** A starter template: its front matter names it, the body is plain Formdown. */
export function starterTemplate(id: string): string {
  return `---
id: ${id}
version: 1
---
# ${strings.newTemplateName}

제목: ___@title

@status: [select options="열림,진행,닫힘"]

@notes: [textarea rows=4]
`
}
