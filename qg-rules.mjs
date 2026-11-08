// @ts-check
import { packageJsonRules, packageManagerRules } from "@slop-lab/qg-rules-js"

// Keep JavaScript policy aligned with the actual toolchain: the server and browser
// harnesses are JavaScript, not a checkJs project. Fixture rules load via the preset.
export const rules = [...packageJsonRules, ...packageManagerRules]
