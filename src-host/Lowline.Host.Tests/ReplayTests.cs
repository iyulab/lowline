using System.Text.Encodings.Web;
using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// A vault's records played back through the sidecar the way the app meets them: the records brought in at the start
/// ingested together, then each later record asked about field by field in its form's order — what is filled by then is
/// what comes before it — and saved, the vault ingested again with it and its thresholds chosen again as they would be.
/// What was offered for each field is written line by line, for the UI's side to turn into the events a save records
/// and count them (<c>src/__tests__/replay.test.ts</c>, which writes the snapshot and runs this). Runs only when
/// <c>LOWLINE_REPLAY_SNAPSHOT</c> names a snapshot; writes the offers to <c>LOWLINE_REPLAY_OFFERS</c>.
/// </summary>
public sealed class ReplayTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerOptions.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>The snapshot as the UI's side wrote it: the vault, and how many of its first documents were brought in.</summary>
    private sealed record Played(IReadOnlyList<TemplateSnapshot> Templates, IReadOnlyList<DocumentSnapshot> Documents, int BroughtIn);

    /// <summary>What was offered for one field of one document, with the fields filled when it was asked.</summary>
    private sealed record Offered(string Doc, string Field, Suggestion Suggestion, IReadOnlyList<string> Filled);

    [Fact]
    public async Task Replays_records_in_the_order_they_were_made()
    {
        var snapshot = Environment.GetEnvironmentVariable("LOWLINE_REPLAY_SNAPSHOT");
        Assert.SkipWhen(string.IsNullOrEmpty(snapshot), "set LOWLINE_REPLAY_SNAPSHOT to replay");
        var output = Environment.GetEnvironmentVariable("LOWLINE_REPLAY_OFFERS") ?? Path.ChangeExtension(snapshot!, ".offers.jsonl");
        var ct = TestContext.Current.CancellationToken;
        var played = JsonSerializer.Deserialize<Played>(await File.ReadAllTextAsync(snapshot!, ct), Json)!;
        var templates = played.Templates.ToDictionary(t => t.Ref, StringComparer.Ordinal);

        await using var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot(played.Templates, [.. played.Documents.Take(played.BroughtIn)]), ct);
        await vault.ThresholdsSelected.WaitAsync(ct);

        var tally = new Dictionary<string, (int Right, int Wrong, int Abstained)>(StringComparer.Ordinal);
        await using var offers = new StreamWriter(output, append: false);
        for (var i = played.BroughtIn; i < played.Documents.Count; i++)
        {
            var document = played.Documents[i];
            var template = templates[document.Template];
            var judged = template.Suggest ?? [];
            foreach (var field in template.Fields.Select(f => f.Name).Where(judged.Contains))
            {
                // A person fills the form from the top: what is filled when a field is asked is what comes before it.
                var before = template.Fields.TakeWhile(f => f.Name != field).Select(f => f.Name)
                    .Where(name => document.Values.TryGetValue(name, out var value) && Filled(value)).ToList();
                var values = before.ToDictionary(name => name, name => document.Values[name], StringComparer.Ordinal);
                var suggestion = (await vault.SuggestAsync(new SuggestRequest(document.Template, field, values, document.Identity), ct))!;
                var settled = document.Values.TryGetValue(field, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                var (right, wrong, abstained) = tally.GetValueOrDefault(field);
                if (suggestion.Value is null) abstained++;
                else if (suggestion.Value == settled) right++;
                else wrong++;
                tally[field] = (right, wrong, abstained);
                await offers.WriteLineAsync(JsonSerializer.Serialize(new Offered(document.Identity, field, suggestion, before), Json));
            }
            await vault.IngestAsync(new VaultSnapshot(played.Templates, [.. played.Documents.Take(i + 1)]), ct);
            await vault.ThresholdsSelected.WaitAsync(ct);
        }

        await Measurement.ReportAsync(
            $"replay · {played.BroughtIn} brought in · {played.Documents.Count - played.BroughtIn} asked · " + string.Join(" · ", tally.Select(t =>
                $"{t.Key}: right {t.Value.Right} wrong {t.Value.Wrong} abstained {t.Value.Abstained}"
                + $" ({(t.Value.Right + t.Value.Wrong == 0 ? 0 : 100.0 * t.Value.Right / (t.Value.Right + t.Value.Wrong)):F0}% right)")), ct);
    }

    private static bool Filled(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => false,
        JsonValueKind.String => value.GetString() is { Length: > 0 },
        JsonValueKind.Array => value.GetArrayLength() > 0,
        _ => true,
    };
}
