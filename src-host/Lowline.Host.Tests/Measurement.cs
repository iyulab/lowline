namespace Lowline.Host.Tests;

/// <summary>
/// Where a measurement's line goes: the test's own output, and the file <c>LOWLINE_PERF_OUT</c> names when
/// set. Measurements run side by side, so their lines reach the file one at a time — two appends at once
/// fail on Windows, where the file is held open by the first.
/// </summary>
internal static class Measurement
{
    private static readonly SemaphoreSlim Writing = new(1, 1);

    public static async Task ReportAsync(string line, CancellationToken ct)
    {
        TestContext.Current.TestOutputHelper?.WriteLine(line);
        if (Environment.GetEnvironmentVariable("LOWLINE_PERF_OUT") is not { Length: > 0 } output) return;
        await Writing.WaitAsync(ct);
        try
        {
            await File.AppendAllTextAsync(output, line + Environment.NewLine, ct);
        }
        finally
        {
            Writing.Release();
        }
    }
}
