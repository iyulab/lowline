using System.Text.Encodings.Web;
using System.Text.Json;
using Gil;
using Gil.Forms;
using Gil.Memory;

namespace Lowline.Host.Tests;

#pragma warning disable GIL0004 // SelectLayersAsync: Gil's experimental two-layer replay is what is measured here.

/// <summary>
/// Whether the similar documents layer, which the sidecar keeps off (no document memory), would keep its promise on
/// a vault's records: each record asked about field by field in its form's order, with memory of the records before
/// it, the two layers' thresholds chosen again as memory grows by a tenth — the layer that answers, whether it was
/// right, and what its replay promised. It reads the snapshot <c>src/__tests__/replay.test.ts</c> writes
/// (<c>LOWLINE_REPLAY_SNAPSHOT</c>) and runs only with <c>LOWLINE_REPLAY_SIMILAR=1</c>; nothing the app does changes.
/// </summary>
public sealed class SimilarLayerTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerOptions.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private sealed record Played(IReadOnlyList<TemplateSnapshot> Templates, IReadOnlyList<DocumentSnapshot> Documents, int BroughtIn);

    /// <summary>One layer's answers on one field: offered, right, and the sum of what its replay promised when it answered.</summary>
    private sealed class Tally
    {
        public int Offered, Right;
        public double Promised;
        public override string ToString() =>
            Offered == 0 ? "0" : $"{Offered} · {100.0 * Right / Offered:F0}% right / {100 * Promised / Offered:F0}% promised";
    }

    [Fact]
    public async Task Measures_the_similar_documents_layer_on_a_replay()
    {
        var snapshot = Environment.GetEnvironmentVariable("LOWLINE_REPLAY_SNAPSHOT");
        Assert.SkipWhen(string.IsNullOrEmpty(snapshot) || Environment.GetEnvironmentVariable("LOWLINE_REPLAY_SIMILAR") != "1",
            "set LOWLINE_REPLAY_SNAPSHOT and LOWLINE_REPLAY_SIMILAR=1 to measure");
        var ct = TestContext.Current.CancellationToken;
        var played = JsonSerializer.Deserialize<Played>(await File.ReadAllTextAsync(snapshot!, ct), Json)!;
        var asked = played.Documents.Skip(played.BroughtIn).Select(d => d.Identity).ToHashSet(StringComparer.Ordinal);
        var lines = new List<string>();

        foreach (var template in played.Templates)
        {
            var bare = Suggestions.Form(template, _ => new FieldThreshold(null, 0, 0));
            if (bare is null) continue;
            var judged = bare.Fields.Where(f => f.Role == FieldRole.Judged).Select(f => f.Name).ToList();
            var documents = played.Documents.Where(d => d.Template == template.Ref).ToList();
            var resolver = new FormResolver(new FieldMemory(), new LexicalMemory());
            var settled = new List<SettledDocument>();
            var chosen = new Dictionary<string, (ThresholdChoice? Key, ThresholdChoice? Similar, FieldThreshold Keyed)>(StringComparer.Ordinal);
            var chosenAt = -1;
            var key = judged.ToDictionary(f => f, _ => new Tally(), StringComparer.Ordinal);
            var similar = judged.ToDictionary(f => f, _ => new Tally(), StringComparer.Ordinal);
            var form = bare;

            foreach (var document in documents)
            {
                // Chosen again as the app chooses its key threshold: once there is enough to replay, then at each tenth —
                // and as the app chooses it (Suggestions.SelectThresholdsAsync): how readily each field's keys are
                // believed, then the fields that key it, then both layers' strengths on that form. The similar layer
                // answers only where the key layer, as the app has it, does not. Before typing only.
                if (settled.Count >= Suggestions.MinimumAnswered && (chosenAt < 0 || Math.Abs(settled.Count - chosenAt) * 10 >= Math.Max(chosenAt, 10)))
                {
                    foreach (var field in judged)
                    {
                        var concentrations = ThresholdSelection.SelectKeyConcentrations(new FieldMemory(), bare, field, settled) is { Count: > 0 } c ? c : null;
                        var concentrated = Suggestions.Form(template, f => new FieldThreshold(null, 0, 0, KeyConcentrations: f == field ? concentrations : null))!;
                        var keyFields = ThresholdSelection.SelectKeyFields(
                            () => new FieldMemory(), concentrated, field, settled, Suggestions.TargetPrecision, Suggestions.MinimumAnswered).KeyFields;
                        var keyed = new FieldThreshold(null, 0, 0, KeyFields: keyFields, KeyConcentrations: concentrations);
                        var layers = await ThresholdSelection.SelectLayersAsync(
                            new FieldMemory(), new LexicalMemory(), Suggestions.Form(template, f => f == field ? keyed : new FieldThreshold(null, 0, 0))!,
                            field, settled, Suggestions.TargetPrecision, Suggestions.MinimumAnswered, ct);
                        chosen[field] = (layers.Key.Chosen, layers.Memory.Chosen, keyed);
                    }
                    chosenAt = settled.Count;
                    form = new FormDefinition(template.Ref, [.. bare.Fields.Select(f => chosen.TryGetValue(f.Name, out var c)
                        ? f with
                        {
                            KeyThreshold = c.Key?.Threshold,
                            MemoryThreshold = c.Similar?.Threshold,
                            KeyFields = c.Keyed.KeyFields,
                            KeyConcentrations = c.Keyed.KeyConcentrations,
                        }
                        : f)], PromptLanguage.English);
                }

                if (asked.Contains(document.Identity))
                {
                    var values = Suggestions.Settled(template, document).Values;
                    foreach (var field in judged)
                    {
                        var held = template.Fields.TakeWhile(f => f.Name != field).Select(f => f.Name)
                            .Where(values.ContainsKey).ToDictionary(n => n, n => values[n], StringComparer.Ordinal);
                        var suggestion = await resolver.SuggestAsync(form, document.Identity, field, held, sets: null, typed: null, ct);
                        if (suggestion is not { Answered: true, Candidates: [var top, ..] }) continue;
                        var right = values.TryGetValue(field, out var value) && top.Value == value;
                        var (tally, promise) = top.Source switch
                        {
                            FieldSource.SettledFieldMemory => (key[field], chosen[field].Key?.Promise ?? 0),
                            FieldSource.SimilarDocument => (similar[field], chosen[field].Similar?.Promise ?? 0),
                            _ => (null, 0),
                        };
                        if (tally is null) continue;
                        tally.Offered++;
                        tally.Promised += promise;
                        if (right) tally.Right++;
                    }
                }

                var remembered = Suggestions.Settled(template, document);
                settled.Add(remembered);
                await resolver.RebuildAsync(form, [remembered], ct);
            }

            foreach (var field in judged)
                lines.Add($"{template.Ref} · {field}: key {key[field]} · similar {similar[field]}");
        }

        await Measurement.ReportAsync(
            $"similar documents layer · {played.Documents.Count - played.BroughtIn} asked · " + string.Join(" · ", lines), ct);
    }
}
