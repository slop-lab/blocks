# @slop-lab/blocks-containers

엔진과 무관한 재귀 블록 트리 연산입니다. `planTreeWrap`은 문서를 변경하지 않고 선택을 하나의 컨테이너로 감쌀 수 있는지 계산합니다.

```ts
import { expandTreeWrapSelection, planTreeWrap } from "@slop-lab/blocks-containers"

const forest = [
  { id: "a", children: [] },
  { id: "b", children: [] },
  { id: "c", children: [] },
]

const plan = planTreeWrap(forest, ["a", "c"])
if (plan.kind === "expanded") {
  // 문서를 바꾸지 않는 명시적 미리보기 선택: ["a", "b", "c"]
  const previewIds = expandTreeWrapSelection(plan)
  console.log(previewIds, plan.additionalIds)
}
```

결과는 다음 중 하나입니다.

- `exact`: 선택된 의미적 하위 트리가 이미 같은 부모 아래의 연속 범위입니다.
- `expanded`: 최소 공통 부모의 연속 자식 범위로 확장해야 하며 `additionalIds`가 추가 범위를 명시합니다. 호출자는 사용자 확인 없이 감싸면 안 됩니다.
- `invalid`: 빈 선택, 누락 ID, 중복 ID, 순환 참조, 잠긴 범위 또는 서로 다른 `boundary` 때문에 전체 연산을 거부합니다.

`parentPath`는 범위를 소유한 부모까지의 ID 경로이고 `range`는 그 부모의 반열림 자식 인덱스 범위입니다. `rootIds`는 새 컨테이너의 직접 자식이 될 블록이며 `coveredIds`는 그 하위 트리를 문서 순서로 펼친 전체 ID입니다. 선택된 조상과 자손이 함께 들어오면 조상 하나로 정규화하므로 ID가 중복되지 않습니다.
