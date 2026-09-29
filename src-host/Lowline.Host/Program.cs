// Lowline's sidecar: projections and suggestions over what the shell hands it. It never reads or
// writes vault files — the shell owns every file, and hands documents over as parsed values.
//
// Started by the shell with a per-launch token in LOWLINE_HOST_TOKEN and the directory for projection caches
// in LOWLINE_HOST_CACHE. It listens on a loopback port the OS picks and prints one ready line with its
// address; every request must carry the token.
using Lowline.Host;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

var builder = WebApplication.CreateSlimBuilder(args);
if (string.IsNullOrEmpty(builder.Configuration["urls"]))
{
    builder.WebHost.UseUrls("http://127.0.0.1:0");
}

// Projection caches live where the shell says, outside any vault; without a place they last one run.
builder.Services.AddSingleton(services =>
    new VaultProjection(services.GetRequiredService<IConfiguration>()[VaultProjection.CacheVariable]));

var app = builder.Build();

var token = app.Configuration[HostAuth.TokenVariable];
if (string.IsNullOrEmpty(token))
{
    Console.Error.WriteLine($"{HostAuth.TokenVariable} is not set; refusing to start without a token.");
    return 2;
}

app.Use(HostAuth.RequireToken(token));

app.MapGet("/health", (VaultProjection vault) => new Health("ok", VaultIndexed: vault.Indexed, MemoryReady: vault.MemoryReady));

// `vault` is the vault's root as the shell names it: it picks the vault's cache, nothing is read from it.
app.MapPost("/vault/ingest", (VaultSnapshot snapshot, string? vault, VaultProjection projection, CancellationToken ct) =>
    projection.IngestAsync(snapshot, vault ?? "", ct));

app.MapGet("/projection/{**template}", async (string template, VaultProjection vault, CancellationToken ct) =>
    await vault.TableAsync(template, ct) is { } table ? Results.Ok(table) : Results.NotFound());

app.MapGet("/curves", (VaultProjection vault, CancellationToken ct) => vault.CurvesAsync(ct));

app.MapPost("/suggest", async (SuggestRequest request, VaultProjection vault, CancellationToken ct) =>
    await vault.SuggestAsync(request, ct) is { } suggestion ? Results.Ok(suggestion) : Results.NotFound());

app.MapPost("/shutdown", (HttpContext context, IHostApplicationLifetime lifetime) =>
{
    context.Response.OnCompleted(() =>
    {
        lifetime.StopApplication();
        return Task.CompletedTask;
    });
    return Results.NoContent();
});

app.Lifetime.ApplicationStarted.Register(() =>
{
    var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>();
    var address = addresses?.Addresses.FirstOrDefault();
    if (address is not null)
    {
        Console.Out.WriteLine($"{ReadyLine.Prefix} {address}");
        Console.Out.Flush();
    }
});

app.Run();
return 0;

/// <summary>Needed by the integration tests' <c>WebApplicationFactory</c>.</summary>
public partial class Program;
