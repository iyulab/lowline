using System.Diagnostics;
using System.Net.Http.Headers;
using Lowline.Host;

namespace Lowline.Host.Tests;

/// <summary>The contract the shell relies on, checked against the real process.</summary>
public sealed class ProcessTests
{
    private static Process Start(string? token)
    {
        var info = new ProcessStartInfo("dotnet", [typeof(Program).Assembly.Location])
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        info.Environment.Remove(HostAuth.TokenVariable);
        if (token is not null) info.Environment[HostAuth.TokenVariable] = token;
        return Process.Start(info)!;
    }

    [Fact]
    public async Task Refuses_to_start_without_a_token()
    {
        using var host = Start(token: null);
        await host.WaitForExitAsync(TestContext.Current.CancellationToken);
        Assert.Equal(2, host.ExitCode);
    }

    [Fact]
    public async Task Prints_its_port_listens_there_on_loopback_and_stops_on_request()
    {
        using var host = Start("t0ken");
        try
        {
            string? line;
            do
            {
                line = await host.StandardOutput.ReadLineAsync(TestContext.Current.CancellationToken);
            } while (line is not null && !line.StartsWith(ReadyLine.Prefix, StringComparison.Ordinal));
            Assert.NotNull(line);
            var port = int.Parse(line[ReadyLine.Prefix.Length..], System.Globalization.CultureInfo.InvariantCulture);
            var address = new Uri($"http://127.0.0.1:{port}");

            using var client = new HttpClient { BaseAddress = address };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "t0ken");
            var health = await client.GetAsync("/health", TestContext.Current.CancellationToken);
            Assert.True(health.IsSuccessStatusCode);

            var shutdown = await client.PostAsync("/shutdown", null, TestContext.Current.CancellationToken);
            Assert.Equal(System.Net.HttpStatusCode.NoContent, shutdown.StatusCode);
            using var exited = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await host.WaitForExitAsync(exited.Token);
            Assert.Equal(0, host.ExitCode);
        }
        finally
        {
            if (!host.HasExited) host.Kill(entireProcessTree: true);
        }
    }
}
