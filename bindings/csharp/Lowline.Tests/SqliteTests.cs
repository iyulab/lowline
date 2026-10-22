using AwesomeAssertions;
using Lowline.Sqlite;

namespace Lowline.Tests;

/// <summary>The SQLite store keeps what the in-memory one keeps, across connections: records by scope in settlement
/// order, a record saved again replacing itself, the tuning, and forgetting by date or id.</summary>
public sealed class SqliteTests : IDisposable
{
    private readonly string _file = Path.Combine(Path.GetTempPath(), $"lowline-{Guid.NewGuid():N}.db");

    private string Connection => $"Data Source={_file};Pooling=False";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly LowlineScope Seoul = new("intake", "seoul");
    private static readonly LowlineScope Busan = new("intake", "busan");

    private static SettledRecord At(string id, int minute) =>
        new(id, EngineTests.Start.AddMinutes(minute), $$"""{"id":"{{id}}","settled_at":{{minute}}}""");

    [Fact]
    public async Task Records_and_tuning_are_kept_by_scope()
    {
        var store = new SqliteLowlineStore(Connection);
        await store.AddRecordAsync(Seoul, At("b", 2), Ct);
        await store.AddRecordAsync(Seoul, At("a", 1), Ct);
        await store.AddRecordAsync(Busan, At("c", 3), Ct);
        await store.AddRecordAsync(Seoul, At("b", 4), Ct);

        var again = new SqliteLowlineStore(Connection);
        (await again.ReadRecordsAsync(Seoul, Ct)).Should().Equal(At("a", 1), At("b", 4));
        (await again.ReadRecordsAsync(Busan, Ct)).Should().Equal(At("c", 3));

        (await again.ReadTuningAsync(Seoul, Ct)).Should().BeNull();
        await again.WriteTuningAsync(Seoul, "{\"settled\":1}", Ct);
        await again.WriteTuningAsync(Seoul, "{\"settled\":2}", Ct);
        (await store.ReadTuningAsync(Seoul, Ct)).Should().Be("{\"settled\":2}");
        (await store.ReadTuningAsync(Busan, Ct)).Should().BeNull();
    }

    [Fact]
    public async Task Records_are_forgotten_by_date_and_by_id()
    {
        var store = new SqliteLowlineStore(Connection);
        foreach (var (id, minute) in new[] { ("a", 1), ("b", 2), ("c", 3) })
        {
            await store.AddRecordAsync(Seoul, At(id, minute), Ct);
        }

        (await store.ForgetBeforeAsync(Seoul, EngineTests.Start.AddMinutes(2), Ct)).Should().Be(1);
        (await store.ForgetAsync(Seoul, "c", Ct)).Should().BeTrue();
        (await store.ForgetAsync(Seoul, "c", Ct)).Should().BeFalse();
        (await store.ReadRecordsAsync(Seoul, Ct)).Should().Equal(At("b", 2));
    }

    [Fact]
    public async Task Forms_run_over_it_as_over_memory()
    {
        var options = new LowlineOptions().UseSqlite(Connection).Form("intake", EngineTests.Intake);
        using (var forms = options.Build())
        {
            foreach (var record in EngineTests.Alternating(40))
            {
                await options.Store!.AddRecordAsync(Seoul, record, Ct);
            }

            var shown = await forms.ProposeAsync(
                Seoul, "new", new Dictionary<string, FieldValue> { ["customer"] = "Beta" }, cancellationToken: Ct);
            shown[0].Suggestion!.Value.Should().Be("lee");
        }

        // Started again over the same database: the stored tuning stands, and it answers the same.
        using var restarted = new LowlineOptions().UseSqlite(Connection).Form("intake", EngineTests.Intake).Build();
        (await restarted.ProposeAsync(
                Seoul, "new", new Dictionary<string, FieldValue> { ["customer"] = "Beta" }, cancellationToken: Ct))[0]
            .Suggestion!.Value.Should().Be("lee");
    }

    public void Dispose()
    {
        File.Delete(_file);
    }
}
