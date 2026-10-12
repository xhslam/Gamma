import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test.skipIf(process.platform !== 'darwin')('Given Gamma 和旧版系统 marker When 解析、恢复和再次写入 Then 身份一致且用户 URL 保持原样', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gamma-eventkit-identity-'))
  const sourcePath = join(directory, 'verify-identity.mm')
  const executablePath = join(directory, 'verify-identity')
  const headerPath = resolve(import.meta.dir, '../../../native/eventkit/planning-identity.h')
  writeFileSync(sourcePath, `
    #import ${JSON.stringify(headerPath)}
    #include <cassert>
    int main() {
      @autoreleasepool {
        NSString *identity = @"1745867f-55df-4d19-a6d3-1a85d1522120";
        NSString *upperIdentity = identity.uppercaseString;
        NSURL *current = GammaPlanningIdentityURL(@"calendar", identity);
        NSURL *legacy = [NSURL URLWithString:[NSString stringWithFormat:@"proma://planning/calendar/%@", identity]];
        assert(([current.absoluteString isEqualToString:[NSString stringWithFormat:@"gamma://planning/calendar/%@", identity]]));
        assert([GammaPlanningIdentity(@"calendar", current) isEqualToString:identity]);
        assert([GammaPlanningIdentity(@"calendar", legacy) isEqualToString:identity]);
        assert(GammaPlanningIdentityMatches(@"calendar", identity, current));
        assert(GammaPlanningIdentityMatches(@"calendar", upperIdentity, legacy));
        assert(!GammaPlanningIdentityMatches(@"reminder", identity, legacy));
        assert(!GammaPlanningIdentityMatches(@"calendar", @"1745867f-55df-4d19-a6d3-1a85d1522121", legacy));
        assert([GammaPlanningUpsertIdentityURL(@"calendar", identity, legacy) isEqual:current]);
        assert([GammaPlanningUpsertIdentityURL(@"calendar", identity, nil) isEqual:current]);
        assert([GammaPlanningUpsertIdentityURL(@"calendar", nil, legacy) isEqual:current]);
        assert(!GammaPlanningIdentityURL(@"calendar", nil));
        assert(!GammaPlanningIdentityURL(@"calendar", @"invalid"));
        for (NSString *value in @[@"https://example.com/proma", @"gamma://planning/calendar/invalid", [legacy.absoluteString stringByAppendingString:@"?extra=1"], [current.absoluteString stringByAppendingString:@"/extra"]]) {
          NSURL *userURL = [NSURL URLWithString:value];
          assert(!GammaPlanningIdentity(@"calendar", userURL));
          assert([GammaPlanningUpsertIdentityURL(@"calendar", identity, userURL) isEqual:userURL]);
        }
        NSURL *legacyReminder = [NSURL URLWithString:[NSString stringWithFormat:@"proma://planning/reminder/%@", identity]];
        assert(GammaPlanningIdentityMatches(@"reminder", identity, legacyReminder));
        assert([GammaPlanningUpsertIdentityURL(@"reminder", identity, legacyReminder).absoluteString hasPrefix:@"gamma://planning/reminder/"]);
      }
    }
  `)
  try {
    const compiled = spawnSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-framework', 'Foundation', sourcePath, '-o', executablePath], { encoding: 'utf8' })
    expect(compiled.status, compiled.stderr).toBe(0)
    const result = spawnSync(executablePath, [], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
