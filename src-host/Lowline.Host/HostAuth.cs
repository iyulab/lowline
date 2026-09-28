using System.Security.Cryptography;
using System.Text;

namespace Lowline.Host;

/// <summary>
/// Every request carries the token the shell generated for this launch. The sidecar serves
/// documents on a loopback port, and another process on the same machine must not read them.
/// </summary>
public static class HostAuth
{
    public const string TokenVariable = "LOWLINE_HOST_TOKEN";

    public static Func<HttpContext, RequestDelegate, Task> RequireToken(string token)
    {
        var expected = Encoding.UTF8.GetBytes($"Bearer {token}");
        return (context, next) =>
        {
            var given = Encoding.UTF8.GetBytes(context.Request.Headers.Authorization.ToString());
            if (!CryptographicOperations.FixedTimeEquals(given, expected))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            }
            return next(context);
        };
    }
}

/// <summary>The line the sidecar prints once it listens: the prefix, a space, its address.</summary>
public static class ReadyLine
{
    public const string Prefix = "lowline-host listening";
}

public sealed record Health(string Status, bool VaultIndexed, bool MemoryReady);
