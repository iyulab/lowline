using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Lowline.Host.Tests;

/// <summary>Checking a model endpoint, against stand-ins on this computer — nothing leaves it.</summary>
public sealed class ModelConnectionTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(5);

    /// <summary>An OpenAI-wire endpoint on a loopback port answering every request with <paramref name="answer"/>.</summary>
    internal static async Task<(WebApplication App, string BaseUrl)> StandIn(Func<HttpContext, Task> answer)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        var app = builder.Build();
        ((IApplicationBuilder)app).Run(new RequestDelegate(answer));
        await app.StartAsync(Ct);
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        return (app, $"{address}/v1");
    }

    [Fact]
    public async Task Lists_the_models_an_endpoint_serves()
    {
        var (app, baseUrl) = await StandIn(context =>
            context.Response.WriteAsJsonAsync(new { @object = "list", data = new[] { new { id = "qwen3-4b", @object = "model" }, new { id = "llama3.2", @object = "model" } } }));
        await using var _ = app;

        var result = await ModelConnection.ProbeAsync(new ModelProbe("custom", baseUrl), Wait, Ct);

        Assert.True(result.Ok);
        Assert.Null(result.Failure);
        Assert.Equal(["qwen3-4b", "llama3.2"], result.ModelIds);
    }

    [Fact]
    public async Task Says_a_key_was_refused_without_the_endpoints_own_words()
    {
        var (app, baseUrl) = await StandIn(async context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = new { message = "Incorrect API key provided: sk-wrong (http://127.0.0.1)" } });
        });
        await using var _ = app;

        var result = await ModelConnection.ProbeAsync(new ModelProbe("custom", baseUrl, ApiKey: "sk-wrong"), Wait, Ct);

        Assert.Equal((false, ModelFailure.Unauthorized, 401), (result.Ok, result.Failure, result.StatusCode));
        Assert.Empty(result.ModelIds);
    }

    [Fact]
    public async Task Says_nothing_listens_where_the_address_points()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();

        var result = await ModelConnection.ProbeAsync(new ModelProbe("custom", $"http://127.0.0.1:{port}/v1"), Wait, Ct);

        Assert.False(result.Ok);
        Assert.Contains(result.Failure, new[] { ModelFailure.Refused, ModelFailure.Unreachable, ModelFailure.Timeout });
    }

    [Theory]
    [InlineData("nope", null, null)] // no such preset
    [InlineData("custom", null, null)] // a custom endpoint has no address of its own
    [InlineData("custom", "not a url", null)]
    [InlineData("openai", null, null)] // a frontier provider needs a key
    public async Task Contacts_nothing_for_what_cannot_be_used(string preset, string? baseUrl, string? key)
    {
        var result = await ModelConnection.ProbeAsync(new ModelProbe(preset, baseUrl, key), Wait, Ct);

        Assert.Equal((false, ModelFailure.Invalid), (result.Ok, result.Failure));
    }
}
