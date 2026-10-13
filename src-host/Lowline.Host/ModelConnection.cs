using IronProw.IronHive;

namespace Lowline.Host;

/// <summary>
/// What the shell asks: whether a model endpoint answers. <see cref="Preset"/> is an IronProw preset id
/// (<c>openai</c>, <c>anthropic</c>, <c>gemini</c>, <c>grok</c>, <c>ollama</c>, <c>gpustack</c>, <c>custom</c>);
/// <see cref="BaseUrl"/> is null for the preset's own. <see cref="ApiKey"/> comes from the system's credential store,
/// handed over by the shell for this one request: the sidecar never keeps it.
/// </summary>
public sealed record ModelProbe(string Preset, string? BaseUrl = null, string? ApiKey = null);

/// <summary>
/// Whether the endpoint answered an authenticated request for its models, and the ids it listed; when it did not,
/// why, as one of <see cref="ModelFailure"/>'s, with the HTTP status when it answered one. The provider's or the
/// operating system's own words are never passed on: they can repeat the address and the provider's details.
/// </summary>
public sealed record ModelProbeResult(bool Ok, string? Failure, int? StatusCode, IReadOnlyList<string> ModelIds);

/// <summary>Why a model endpoint did not answer, for the app to say in its own words.</summary>
public static class ModelFailure
{
    /// <summary>What was entered cannot be used — an unknown preset, a missing or malformed address, a missing key; nothing was contacted.</summary>
    public const string Invalid = "invalid";

    /// <summary>The endpoint refused the key.</summary>
    public const string Unauthorized = "unauthorized";

    /// <summary>The endpoint answered with another HTTP error (a wrong path, say).</summary>
    public const string HttpStatus = "http-status";

    /// <summary>No answer in time.</summary>
    public const string Timeout = "timeout";

    /// <summary>The computer is there, and nothing listens on the port.</summary>
    public const string Refused = "refused";

    /// <summary>The host name does not resolve.</summary>
    public const string HostNotFound = "host-not-found";

    /// <summary>The network or the host cannot be reached.</summary>
    public const string Unreachable = "unreachable";

    /// <summary>Any other failure on the way: a secure connection that failed, a reset, an answer that is not one.</summary>
    public const string Transport = "transport";
}

/// <summary>Model endpoints a person names in the app: checked here, through IronProw's presets.</summary>
public static class ModelConnection
{
    /// <summary>Checks <paramref name="probe"/>'s endpoint with one request, as long as <paramref name="timeout"/> (IronProw's default when null).</summary>
    public static async Task<ModelProbeResult> ProbeAsync(ModelProbe probe, TimeSpan? timeout, CancellationToken cancellationToken)
    {
        var endpoint = new ByoEndpoint(probe.Preset, NullIfBlank(probe.BaseUrl), NullIfBlank(probe.ApiKey));
        var result = await ByoPresets.ProbeAsync(endpoint, timeout, cancellationToken);
        return result.Ok
            ? new ModelProbeResult(true, null, null, result.ModelIds)
            : new ModelProbeResult(false, Word(result.Failure), result.StatusCode, []);
    }

    private static string? NullIfBlank(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static string Word(ByoProbeFailure? failure) => failure switch
    {
        ByoProbeFailure.Invalid => ModelFailure.Invalid,
        ByoProbeFailure.Unauthorized => ModelFailure.Unauthorized,
        ByoProbeFailure.HttpStatus => ModelFailure.HttpStatus,
        ByoProbeFailure.Timeout => ModelFailure.Timeout,
        ByoProbeFailure.Refused => ModelFailure.Refused,
        ByoProbeFailure.HostNotFound => ModelFailure.HostNotFound,
        ByoProbeFailure.Unreachable => ModelFailure.Unreachable,
        _ => ModelFailure.Transport,
    };
}
