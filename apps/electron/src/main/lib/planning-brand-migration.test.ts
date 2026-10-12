import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const managerModulePath = join(import.meta.dir, 'planning-manager.ts')
const repoRoot = dirname(dirname(dirname(dirname(dirname(import.meta.dir)))))
const electronBinary = createRequire(import.meta.url)('electron') as string

async function verifyPlanningMigration(phases: string[]): Promise<void> {
  const taskHome = mkdtempSync(join(tmpdir(), 'gamma-planning-migration-'))
  const sourcePath = join(taskHome, 'verify-planning-migration.ts')
  const outputPath = join(taskHome, 'verify-planning-migration.mjs')
  writeFileSync(sourcePath, `
    import assert from 'node:assert/strict'
    import { mkdirSync } from 'node:fs'
    import { createRequire, syncBuiltinESMExports } from 'node:module'
    import { join } from 'node:path'
    import { DatabaseSync } from 'node:sqlite'
    import * as manager from ${JSON.stringify(managerModulePath)}

    const fixtureOS = createRequire(import.meta.url)('node:os')
    fixtureOS.homedir = () => process.env.GAMMA_TEST_HOME
    syncBuiltinESMExports()
    const configDir = join(process.env.GAMMA_TEST_HOME, '.gamma-dev')
    mkdirSync(configDir, { recursive: true })
    const databasePath = join(configDir, 'planning.db')
    const phase = process.env.GAMMA_TEST_PHASE
    const tables = ['planning_sync_bindings', 'planning_sync_outbox', 'planning_sync_cleanup', 'planning_native_bindings', 'planning_native_outbox', 'planning_native_sync_conflicts', 'planning_sync_profile_conflicts']
    const eventId = '1745867f-55df-4d19-a6d3-1a85d1522120'
    const nativeId = '1745867f-55df-4d19-a6d3-1a85d1522121'
    const now = 1_700_000_000_000
    const userTitle = '用户原文 Proma / promaIdentity'
    const userNotes = 'proma://planning/calendar/ 自定义备注'
    const nativeSnapshot = { calendarItemIdentifier: 'native-locator', title: userTitle, notes: userNotes, promaIdentity: nativeId, startAt: now, endAt: now + 60_000, allDay: false, lastModifiedAt: now }
    const profileSnapshot = { ...nativeSnapshot, calendarItemIdentifier: 'profile-recovered-locator', promaIdentity: eventId }
    const gammaNativeSnapshot = { calendarItemIdentifier: 'native-locator', title: userTitle, notes: userNotes, gammaIdentity: nativeId, startAt: now, endAt: now + 60_000, allDay: false, lastModifiedAt: now }
    const gammaProfileSnapshot = { ...gammaNativeSnapshot, calendarItemIdentifier: 'profile-recovered-locator', gammaIdentity: eventId }

    if (phase === 'seed' || phase === 'seed-failure') {
      // 先创建全部现有约束，再恢复 v9 列名，得到独立旧版本数据库；下一进程执行真实升级。
      manager.listTodos()
      const db = new DatabaseSync(databasePath)
      db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE')
      db.prepare('INSERT INTO planning_sync_profiles (id,entity,target_id,target_title,source_title,created_at,updated_at) VALUES (:id,:entity,:target,:title,:source,:now,:now)').run({ id: 'profile', entity: 'calendar', target: 'managed-calendar', title: '旧受管集合', source: '本地', now })
      db.prepare('INSERT INTO planning_native_connections (id,entity,target_id,target_title,source_title,source_type,can_write,connected_at,updated_at) VALUES (:id,:entity,:target,:title,:source,:type,1,:now,:now)').run({ id: 'connection', entity: 'calendar', target: 'external-calendar', title: '已连接用户集合', source: '本地', type: 'local', now })
      for (const [id, connectionId] of [[eventId, null], [nativeId, 'connection']]) db.prepare('INSERT INTO calendar_events (id,title,notes,start_at,end_at,native_connection_id,created_at,updated_at) VALUES (:id,:title,:notes,:now,:endAt,:connectionId,:now,:now)').run({ id, title: userTitle, notes: userNotes, now, endAt: now + 60_000, connectionId })
      db.prepare('INSERT INTO planning_sync_bindings (profile_id,target_id,gamma_entity_id,calendar_item_identifier,last_synced_hash,last_synced_at) VALUES (:profile,:target,:id,:locator,:hash,:now)').run({ profile: 'profile', target: 'managed-calendar', id: eventId, locator: 'old-profile-locator', hash: manager.planningNativeCalendarHash(profileSnapshot), now })
      db.prepare('INSERT INTO planning_sync_outbox (id,profile_id,target_id,operation,gamma_entity_id,next_attempt_at,created_at,updated_at) VALUES (:id,:profile,:target,:operation,:entityId,:now,:now,:now)').run({ id: 'managed-outbox', profile: 'profile', target: 'managed-calendar', operation: 'upsert', entityId: eventId, now })
      db.prepare('INSERT INTO planning_sync_cleanup (id,entity,target_id,gamma_entity_id,calendar_item_identifier,next_attempt_at,created_at,updated_at) VALUES (:id,:entity,:target,:entityId,:locator,:now,:now,:now)').run({ id: 'cleanup', entity: 'calendar', target: 'old-calendar', entityId: eventId, locator: 'old-locator', now })
      db.prepare('INSERT INTO planning_native_bindings (connection_id,gamma_entity_id,calendar_item_identifier,last_native_hash,last_synced_at) VALUES (:connection,:id,:locator,:hash,:now)').run({ connection: 'connection', id: nativeId, locator: 'native-locator', hash: JSON.stringify(nativeSnapshot), now })
      db.prepare('INSERT INTO planning_native_outbox (id,connection_id,operation,gamma_entity_id,next_attempt_at,created_at,updated_at) VALUES (:id,:connection,:operation,:entityId,:now,:now,:now)').run({ id: 'native-outbox', connection: 'connection', operation: 'upsert', entityId: nativeId, now })
      db.prepare('INSERT INTO planning_native_sync_conflicts (id,connection_id,entity,gamma_entity_id,kind,native_item_json,detected_at) VALUES (:id,:connection,:entity,:entityId,:kind,:payload,:now)').run({ id: 'native-conflict', connection: 'connection', entity: 'calendar', entityId: nativeId, kind: 'changed', payload: JSON.stringify(nativeSnapshot), now })
      db.prepare('INSERT INTO planning_sync_profile_conflicts (id,profile_id,gamma_entity_id,kind,native_item_json,detected_at) VALUES (:id,:profile,:entityId,:kind,:payload,:now)').run({ id: 'profile-conflict', profile: 'profile', entityId: eventId, kind: 'changed', payload: JSON.stringify(profileSnapshot), now })
      // 未被本次改名拥有的旧内容与损坏 JSON 必须保留，不能进行字符串级全局替换。
      db.prepare('INSERT INTO planning_native_bindings (connection_id,gamma_entity_id,calendar_item_identifier,last_native_hash) VALUES (:connection,:id,:locator,:payload)').run({ connection: 'connection', id: 'invalid-json', locator: 'invalid-json-locator', payload: '{"promaIdentity":broken' })
      for (const table of tables) {
        if (phase === 'seed-failure' && table === 'planning_sync_profile_conflicts') continue
        db.exec('ALTER TABLE ' + table + ' RENAME COLUMN gamma_entity_id TO proma_entity_id')
      }
      db.exec('PRAGMA user_version = 9; COMMIT')
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9)
      db.close()
    } else if (phase === 'verify-failure') {
      assert.throws(() => manager.listTodos(), /proma_entity_id/)
      const db = new DatabaseSync(databasePath)
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9)
      const columns = db.prepare('PRAGMA table_info(planning_sync_bindings)').all().map((column) => column.name)
      assert.ok(columns.includes('proma_entity_id'))
      assert.equal(columns.includes('gamma_entity_id'), false)
      assert.equal(db.prepare('SELECT proma_entity_id FROM planning_sync_bindings').get().proma_entity_id, eventId)
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
      db.close()
    } else {
      manager.listTodos()
      const db = new DatabaseSync(databasePath)
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 10)
      for (const table of tables) {
        const columns = db.prepare('PRAGMA table_info(' + table + ')').all().map((column) => column.name)
        assert.ok(columns.includes('gamma_entity_id'), table)
        assert.equal(columns.includes('proma_entity_id'), false, table)
        assert.ok(db.prepare('SELECT gamma_entity_id FROM ' + table).all().some((row) => row.gamma_entity_id === (table.startsWith('planning_native') ? nativeId : eventId)), table)
      }
      assert.equal(db.prepare('SELECT last_native_hash FROM planning_native_bindings WHERE gamma_entity_id=:id').get({ id: nativeId }).last_native_hash, JSON.stringify(gammaNativeSnapshot))
      assert.equal(db.prepare('SELECT last_native_hash FROM planning_native_bindings WHERE gamma_entity_id=:id').get({ id: 'invalid-json' }).last_native_hash, '{"promaIdentity":broken')
      assert.equal(db.prepare('SELECT native_item_json FROM planning_native_sync_conflicts').get().native_item_json, JSON.stringify(gammaNativeSnapshot))
      assert.equal(db.prepare('SELECT native_item_json FROM planning_sync_profile_conflicts').get().native_item_json, JSON.stringify(gammaProfileSnapshot))
      assert.equal(manager.getCalendarEvent(eventId).title, userTitle)
      assert.equal(manager.getCalendarEvent(eventId).notes, userNotes)
      assert.equal(manager.listCalendarEvents().length, 2)
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
      assert.deepEqual(manager.listPlanningNativeSyncConflicts().map((conflict) => conflict.gammaEntityId).sort(), [eventId, nativeId])
      if (phase === 'behavior') {
        // 旧 hash 升级后仍与新 DTO 相同，待同步本地编辑不会被凭空判为双侧冲突。
        db.exec("DELETE FROM planning_native_sync_conflicts WHERE id='native-conflict'")
        manager.applyPlanningNativeConnectionItems('connection', [gammaNativeSnapshot], { fullSnapshot: false })
        assert.equal(manager.listPlanningNativeSyncConflicts().some((conflict) => conflict.connectionId === 'connection'), false)
        assert.equal(db.prepare('SELECT count(*) AS count FROM planning_native_outbox').get().count, 1)
        // 旧冲突 JSON 迁移后，用户明确保留系统的恢复 locator 仍能准确回流同一个本地事项。
        assert.equal(manager.resolvePlanningNativeSyncConflict({ id: 'profile-conflict', resolution: 'keep_system' }), true)
        assert.equal(manager.listCalendarEvents().length, 2)
        assert.equal(manager.getCalendarEvent(eventId).title, userTitle)
        assert.deepEqual(manager.listPlanningSyncBindingIdentifiers('profile', 'managed-calendar'), ['profile-recovered-locator'])
      }
      db.close()
    }
  `)
  try {
    const built = await Bun.build({ entrypoints: [sourcePath], target: 'node', format: 'esm', external: ['electron', 'node:sqlite'] })
    expect(built.success, built.logs.map((log) => log.message).join('\n')).toBe(true)
    const script = built.outputs[0]
    if (!script) throw new Error('未生成 Planning 品牌迁移验证脚本')
    await Bun.write(outputPath, script)
    for (const phase of phases) {
      const result = spawnSync(electronBinary, [outputPath], {
        cwd: repoRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', GAMMA_TEST_HOME: taskHome, GAMMA_DEV: '1', GAMMA_TEST_PHASE: phase },
        encoding: 'utf8',
      })
      expect(result.status, phase + '\n' + result.stdout + '\n' + result.stderr).toBe(0)
    }
  } finally {
    rmSync(taskHome, { recursive: true, force: true })
  }
}

test('Given Proma v9 计划数据库 When Gamma 连续启动 Then 映射、出站队列和冲突无损升级且保留用户原文', async () => {
  await verifyPlanningMigration(['seed', 'verify', 'verify', 'behavior'])
})

test('Given 旧计划数据库存在不兼容列 When Gamma 升级失败 Then 整个迁移事务回滚并保留 v9 数据', async () => {
  await verifyPlanningMigration(['seed-failure', 'verify-failure'])
})
