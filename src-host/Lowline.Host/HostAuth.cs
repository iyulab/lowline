namespace Lowline.Host;

/// <summary>
/// Every request carries the token the shell generated for this launch (checked by
/// <c>UseBearerToken</c>). The sidecar serves documents on a loopback port, and another process on
/// the same machine must not read them.
/// </summary>
public static class HostAuth
{
    /// <summary>Must match <c>TOKEN_VARIABLE</c> in the shell's <c>host.rs</c>.</summary>
    public const string TokenVariable = "LOWLINE_HOST_TOKEN";
}

/// <summary>The line the sidecar prints once it listens: the prefix, then its port.</summary>
public static class ReadyLine
{
    /// <summary>Must match <c>READY_PREFIX</c> in the shell's <c>host.rs</c>.</summary>
    public const string Prefix = "lowline-host port=";
}

public sealed record Health(string Status, bool VaultIndexed, bool MemoryReady);
