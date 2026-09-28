using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// How often suggestions are right, abstain or wrong on synthetic intake records whose owner follows
/// from the request and whose department is random: the first <c>n</c> are confirmed, the next 100 asked.
/// Runs only with <c>LOWLINE_PERF=1</c>; writes its figures to <c>LOWLINE_PERF_OUT</c> when set.
/// </summary>
public sealed class SuggestionQualityTests
{
    private const int Asked = 100;

    [Theory]
    [InlineData(50)]
    [InlineData(300)]
    public async Task Measures_right_wrong_and_abstained(int confirmed)
    {
        Assert.SkipUnless(Environment.GetEnvironmentVariable("LOWLINE_PERF") == "1", "set LOWLINE_PERF=1 to measure");
        var ct = TestContext.Current.CancellationToken;
        var all = RebuildCostTests.Synthetic(confirmed + Asked);
        var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot(all.Templates, [.. all.Documents.Take(confirmed)]), ct);
        await vault.ThresholdsSelected.WaitAsync(ct);

        int right = 0, wrong = 0, abstained = 0;
        foreach (var document in all.Documents.Skip(confirmed))
        {
            var values = document.Values.Where(v => v.Key != "담당").ToDictionary(v => v.Key, v => v.Value);
            var suggestion = await vault.SuggestAsync(new SuggestRequest("intake@1", "담당", values), ct);
            if (suggestion!.Value is null) abstained++;
            else if (suggestion.Value == document.Values["담당"].GetString()) right++;
            else wrong++;
        }

        var line = $"{confirmed} confirmed · {Asked} asked · right {right} · wrong {wrong} · abstained {abstained}";
        TestContext.Current.TestOutputHelper?.WriteLine(line);
        if (Environment.GetEnvironmentVariable("LOWLINE_PERF_OUT") is { Length: > 0 } output)
            await File.AppendAllTextAsync(output, line + Environment.NewLine, ct);
    }
}
