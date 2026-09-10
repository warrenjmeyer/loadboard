// ---------------------------------------------------------------------------
// Copy one table between two Azure SQL databases.
//
//   $env:SRC_SERVER = 'millstream-wjm.database.windows.net'
//   $env:SRC_DATABASE = 'Millstream'; $env:SRC_USER = 'sqlmillstream'; $env:SRC_PASSWORD = '...'
//   $env:DST_SERVER = 'dev-techgacity-sqlserver.database.windows.net'
//   $env:DST_DATABASE = 'TMS';        $env:DST_USER = '...';            $env:DST_PASSWORD = '...'
//
//   node tools/copy-table.mjs dbo.Loads                # into dbo.Loads on the target
//   node tools/copy-table.mjs dbo.Loads TMS.Loads      # into a different schema/table
//   node tools/copy-table.mjs dbo.Loads --create       # create the target table first
//   node tools/copy-table.mjs dbo.Loads --dry-run      # say what would happen
//   node tools/copy-table.mjs dbo.Loads --truncate     # empty the target first
//
// Azure SQL cannot query across servers (that needs Elastic Query and an
// external data source per table), so a copy is: read every row here, write
// it there. This does that in batches of 500, with a MERGE on the primary
// key so re-running updates rather than duplicates.
//
// COLUMNS ARE MATCHED BY NAME. Only columns that exist on both sides are
// copied; the rest are listed so nobody is surprised. A target table that
// has grown a NOT NULL column the source lacks will refuse the insert, and
// the error will say which.
//
// --create makes a plain table on the target with the source's columns and
// types and its primary key -- NO foreign keys, defaults, or check
// constraints. Those refer to tables that may not be there; add them with
// the migration scripts once the referenced tables have been copied too.
//
// Both credentials come from the environment and are never written down.
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sql = require('../api/node_modules/mssql')

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const names = args.filter((a) => !a.startsWith('--'))
if (names.length === 0) {
  console.error('Usage: node tools/copy-table.mjs <schema.table> [<target schema.table>] [--create] [--truncate] [--dry-run]')
  process.exit(2)
}
const [srcSchema, srcTable] = split(names[0])
const [dstSchema, dstTable] = split(names[1] || names[0])

function split(name) {
  const parts = name.split('.')
  return parts.length === 2 ? parts : ['dbo', parts[0]]
}

function config(prefix) {
  const e = process.env
  const cfg = {
    server: e[`${prefix}_SERVER`], database: e[`${prefix}_DATABASE`], user: e[`${prefix}_USER`], password: e[`${prefix}_PASSWORD`],
    options: { encrypt: true }, connectionTimeout: 120000, requestTimeout: 300000,
  }
  for (const k of ['server', 'database', 'user', 'password']) {
    if (!cfg[k]) { console.error(`${prefix}_${k.toUpperCase()} is not set`); process.exit(2) }
  }
  return cfg
}

const bracket = (s) => `[${String(s).replace(/]/g, ']]')}]`

async function columnsOf(pool, schema, table) {
  const r = await pool.request().input('s', sql.NVarChar, schema).input('t', sql.NVarChar, table).query(`
    SELECT c.COLUMN_NAME AS name, c.DATA_TYPE AS type, c.CHARACTER_MAXIMUM_LENGTH AS len,
           c.NUMERIC_PRECISION AS prec, c.NUMERIC_SCALE AS scale, c.IS_NULLABLE AS nullable,
           COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS identity_col,
           CASE WHEN k.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS pk
    FROM INFORMATION_SCHEMA.COLUMNS AS c
    LEFT JOIN (
      SELECT kcu.COLUMN_NAME, kcu.TABLE_SCHEMA, kcu.TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS kcu ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
    ) AS k ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME
    WHERE c.TABLE_SCHEMA = @s AND c.TABLE_NAME = @t
    ORDER BY c.ORDINAL_POSITION;
  `)
  return r.recordset
}

function typeSql(c) {
  const t = c.type.toUpperCase()
  if (['NVARCHAR', 'VARCHAR', 'NCHAR', 'CHAR', 'VARBINARY', 'BINARY'].includes(t)) return `${t}(${c.len === -1 ? 'MAX' : c.len})`
  if (['DECIMAL', 'NUMERIC'].includes(t)) return `${t}(${c.prec},${c.scale})`
  if (['DATETIME2', 'TIME', 'DATETIMEOFFSET'].includes(t)) return `${t}(${c.scale})`
  return t
}

const src = await new sql.ConnectionPool(config('SRC')).connect()
const dst = await new sql.ConnectionPool(config('DST')).connect()

const srcCols = await columnsOf(src, srcSchema, srcTable)
if (srcCols.length === 0) { console.error(`${srcSchema}.${srcTable} does not exist on the source`); process.exit(1) }
let dstCols = await columnsOf(dst, dstSchema, dstTable)

if (dstCols.length === 0) {
  if (!flags.has('--create')) {
    console.error(`${dstSchema}.${dstTable} does not exist on the target. Pass --create to make it.`)
    process.exit(1)
  }
  const pk = srcCols.filter((c) => c.pk).map((c) => bracket(c.name))
  const ddl = `CREATE TABLE ${bracket(dstSchema)}.${bracket(dstTable)} (\n  ${srcCols.map((c) =>
    `${bracket(c.name)} ${typeSql(c)}${c.identity_col ? ' IDENTITY(1,1)' : ''} ${c.nullable === 'YES' ? 'NULL' : 'NOT NULL'}`).join(',\n  ')}${pk.length ? `,\n  PRIMARY KEY (${pk.join(', ')})` : ''}\n);`
  console.log(ddl)
  if (!flags.has('--dry-run')) {
    await dst.request().query(`IF SCHEMA_ID(N'${dstSchema.replace(/'/g, "''")}') IS NULL EXEC('CREATE SCHEMA ${bracket(dstSchema)}');`)
    await dst.request().query(ddl)
    dstCols = await columnsOf(dst, dstSchema, dstTable)
    console.log(`created ${dstSchema}.${dstTable}`)
  } else {
    dstCols = srcCols
  }
}

const dstByName = new Map(dstCols.map((c) => [c.name.toLowerCase(), c]))
const shared = srcCols.filter((c) => dstByName.has(c.name.toLowerCase()))
const onlySrc = srcCols.filter((c) => !dstByName.has(c.name.toLowerCase())).map((c) => c.name)
const onlyDst = dstCols.filter((c) => !srcCols.some((s) => s.name.toLowerCase() === c.name.toLowerCase())).map((c) => c.name)
const keys = shared.filter((c) => c.pk)
const hasIdentity = shared.some((c) => dstByName.get(c.name.toLowerCase()).identity_col)

console.log(`source ${srcSchema}.${srcTable}: ${srcCols.length} columns; target ${dstSchema}.${dstTable}: ${dstCols.length}; copying ${shared.length}`)
if (onlySrc.length) console.log(`  not on target, skipped: ${onlySrc.join(', ')}`)
if (onlyDst.length) console.log(`  only on target, left null/default: ${onlyDst.join(', ')}`)
if (keys.length === 0) console.log('  no shared primary key: rows are inserted, not merged, so re-running duplicates')

const count = await src.request().query(`SELECT COUNT(*) AS n FROM ${bracket(srcSchema)}.${bracket(srcTable)};`)
console.log(`${count.recordset[0].n} rows to copy`)
if (flags.has('--dry-run')) { console.log('dry run; nothing written'); process.exit(0) }

if (flags.has('--truncate')) {
  await dst.request().query(`DELETE FROM ${bracket(dstSchema)}.${bracket(dstTable)};`)
  console.log('target emptied')
}

const colList = shared.map((c) => bracket(c.name)).join(', ')
const rows = (await src.request().query(`SELECT ${colList} FROM ${bracket(srcSchema)}.${bracket(srcTable)};`)).recordset

let written = 0
const BATCH = 500
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH)
  // Bulk-insert the batch into a staging table, then one MERGE from it: the
  // fast path that still upserts. A GLOBAL temp table (##), because the
  // bulk load and the merge may run on different pooled connections and a
  // local temp table would not survive the hop. Types come from the
  // target's definition.
  const stageName = `##copy_${dstTable.replace(/[^A-Za-z0-9]/g, '_')}_${process.pid}`
  const stage = new sql.Table(stageName)
  stage.create = true
  for (const c of shared) {
    const t = dstByName.get(c.name.toLowerCase())
    stage.columns.add(c.name, mssqlType(t), { nullable: true })
  }
  for (const r of batch) stage.rows.add(...shared.map((c) => r[c.name]))
  await new sql.Request(dst).bulk(stage)
  const on = keys.length ? keys.map((c) => `t.${bracket(c.name)} = s.${bracket(c.name)}`).join(' AND ') : '1 = 0'
  const nonKeys = shared.filter((c) => !c.pk)
  const update = nonKeys.length ? `WHEN MATCHED THEN UPDATE SET ${nonKeys.map((c) => `t.${bracket(c.name)} = s.${bracket(c.name)}`).join(', ')}` : ''
  const merge = `
    ${hasIdentity ? `SET IDENTITY_INSERT ${bracket(dstSchema)}.${bracket(dstTable)} ON;` : ''}
    MERGE ${bracket(dstSchema)}.${bracket(dstTable)} AS t
    USING ${stageName} AS s ON ${on}
    ${update}
    WHEN NOT MATCHED THEN INSERT (${colList}) VALUES (${shared.map((c) => `s.${bracket(c.name)}`).join(', ')});
    ${hasIdentity ? `SET IDENTITY_INSERT ${bracket(dstSchema)}.${bracket(dstTable)} OFF;` : ''}
    DROP TABLE ${stageName};
  `
  await new sql.Request(dst).query(merge)
  written += batch.length
  console.log(`  ${written}/${rows.length}`)
}

console.log(`done: ${written} rows merged into ${dstSchema}.${dstTable}`)
await src.close()
await dst.close()

function mssqlType(c) {
  const t = c.type.toUpperCase()
  const len = c.len === -1 ? sql.MAX : c.len
  switch (t) {
    case 'NVARCHAR': return sql.NVarChar(len)
    case 'VARCHAR': return sql.VarChar(len)
    case 'NCHAR': return sql.NChar(len)
    case 'CHAR': return sql.Char(len)
    case 'INT': return sql.Int
    case 'BIGINT': return sql.BigInt
    case 'SMALLINT': return sql.SmallInt
    case 'TINYINT': return sql.TinyInt
    case 'BIT': return sql.Bit
    case 'DECIMAL': case 'NUMERIC': return sql.Decimal(c.prec, c.scale)
    case 'MONEY': return sql.Money
    case 'FLOAT': return sql.Float
    case 'REAL': return sql.Real
    case 'DATE': return sql.Date
    case 'DATETIME': return sql.DateTime
    case 'DATETIME2': return sql.DateTime2(c.scale)
    case 'DATETIMEOFFSET': return sql.DateTimeOffset(c.scale)
    case 'TIME': return sql.Time(c.scale)
    case 'UNIQUEIDENTIFIER': return sql.UniqueIdentifier
    case 'VARBINARY': return sql.VarBinary(len)
    default: return sql.NVarChar(sql.MAX)
  }
}
