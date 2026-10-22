using Microsoft.Data.Sqlite;

namespace Lowline.Sqlite;

/// <summary>An <see cref="ILowlineStore"/> in a SQLite database: two tables of its own, <c>lowline_records</c> and
/// <c>lowline_tunings</c>, made on first use beside whatever else the database holds. The engine's state stays out of
/// the host's own tables.</summary>
public sealed class SqliteLowlineStore : ILowlineStore
{
    private readonly string _connectionString;
    private readonly Lock _made = new();
    private volatile bool _ready;

    /// <summary>A store in the database <paramref name="connectionString"/> opens.</summary>
    public SqliteLowlineStore(string connectionString)
    {
        ArgumentException.ThrowIfNullOrEmpty(connectionString);
        _connectionString = connectionString;
    }

    private async Task<SqliteConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        if (_ready)
        {
            return connection;
        }

        lock (_made)
        {
            if (!_ready)
            {
                using var make = connection.CreateCommand();
                make.CommandText = """
                    CREATE TABLE IF NOT EXISTS lowline_records (
                        form TEXT NOT NULL,
                        space TEXT NOT NULL,
                        id TEXT NOT NULL,
                        settled_at INTEGER NOT NULL,
                        record TEXT NOT NULL,
                        PRIMARY KEY (form, space, id)
                    );
                    CREATE INDEX IF NOT EXISTS lowline_records_settled
                        ON lowline_records (form, space, settled_at);
                    CREATE TABLE IF NOT EXISTS lowline_tunings (
                        form TEXT NOT NULL,
                        space TEXT NOT NULL,
                        tuning TEXT NOT NULL,
                        PRIMARY KEY (form, space)
                    );
                    """;
                make.ExecuteNonQuery();
                _ready = true;
            }
        }

        return connection;
    }

    private static SqliteCommand Command(SqliteConnection connection, string text, LowlineScope scope)
    {
        var command = connection.CreateCommand();
        command.CommandText = text;
        command.Parameters.AddWithValue("$form", scope.Form);
        command.Parameters.AddWithValue("$space", scope.Space);
        return command;
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<SettledRecord>> ReadRecordsAsync(
        LowlineScope scope, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var read = Command(
            connection,
            "SELECT id, settled_at, record FROM lowline_records WHERE form = $form AND space = $space " +
            "ORDER BY settled_at, rowid",
            scope);
        await using var rows = await read.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var records = new List<SettledRecord>();
        while (await rows.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            records.Add(new SettledRecord(
                rows.GetString(0), new DateTimeOffset(rows.GetInt64(1), TimeSpan.Zero), rows.GetString(2)));
        }

        return records;
    }

    /// <inheritdoc/>
    public async Task AddRecordAsync(
        LowlineScope scope, SettledRecord record, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(record);
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var write = Command(
            connection,
            "INSERT INTO lowline_records (form, space, id, settled_at, record) VALUES ($form, $space, $id, $at, $record) " +
            "ON CONFLICT (form, space, id) DO UPDATE SET settled_at = excluded.settled_at, record = excluded.record",
            scope);
        write.Parameters.AddWithValue("$id", record.Id);
        write.Parameters.AddWithValue("$at", record.SettledAt.UtcTicks);
        write.Parameters.AddWithValue("$record", record.Json);
        await write.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc/>
    public async Task<string?> ReadTuningAsync(LowlineScope scope, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var read = Command(
            connection, "SELECT tuning FROM lowline_tunings WHERE form = $form AND space = $space", scope);
        return await read.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
    }

    /// <inheritdoc/>
    public async Task WriteTuningAsync(LowlineScope scope, string tuning, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(tuning);
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var write = Command(
            connection,
            "INSERT INTO lowline_tunings (form, space, tuning) VALUES ($form, $space, $tuning) " +
            "ON CONFLICT (form, space) DO UPDATE SET tuning = excluded.tuning",
            scope);
        write.Parameters.AddWithValue("$tuning", tuning);
        await write.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc/>
    public async Task<int> ForgetBeforeAsync(
        LowlineScope scope, DateTimeOffset before, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var forget = Command(
            connection,
            "DELETE FROM lowline_records WHERE form = $form AND space = $space AND settled_at < $before",
            scope);
        forget.Parameters.AddWithValue("$before", before.UtcTicks);
        return await forget.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc/>
    public async Task<bool> ForgetAsync(LowlineScope scope, string id, CancellationToken cancellationToken = default)
    {
        await using var connection = await OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var forget = Command(
            connection, "DELETE FROM lowline_records WHERE form = $form AND space = $space AND id = $id", scope);
        forget.Parameters.AddWithValue("$id", id);
        return await forget.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) > 0;
    }
}

/// <summary>Keeping a host's records in SQLite.</summary>
public static class SqliteLowlineOptions
{
    /// <summary>Keeps the records in the SQLite database <paramref name="connectionString"/> opens.</summary>
    public static T UseSqlite<T>(this T options, string connectionString)
        where T : LowlineOptions
    {
        ArgumentNullException.ThrowIfNull(options);
        options.UseStore(new SqliteLowlineStore(connectionString));
        return options;
    }
}
