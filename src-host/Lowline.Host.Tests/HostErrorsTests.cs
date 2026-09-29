using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;

namespace Lowline.Host.Tests;

/// <summary>
/// What the sidecar says when a request fails: the exception's type and the methods it passed
/// through — never its message, which can hold a vault path or a value.
/// </summary>
public sealed class HostErrorsTests
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Throws() => throw new InvalidOperationException("문서/회의록.md — 담당: 장비");

    [Fact]
    public void Names_the_type_and_the_methods_but_not_the_message()
    {
        Exception caught;
        try
        {
            Throws();
            throw new UnreachableException();
        }
        catch (InvalidOperationException e)
        {
            caught = e;
        }

        var failure = HostErrors.Of(caught);

        Assert.Equal("System.InvalidOperationException", failure.Kind);
        Assert.Contains("Lowline.Host.Tests.HostErrorsTests.Throws", failure.Frames);
        var json = JsonSerializer.Serialize(failure, JsonSerializerOptions.Web);
        Assert.DoesNotContain("회의록", json);
        Assert.DoesNotContain("장비", json);
        Assert.StartsWith("{\"kind\":", json);
    }

    [Fact]
    public async Task Leaves_out_the_frames_an_await_adds()
    {
        static async Task Inner()
        {
            await Task.Yield();
            throw new InvalidOperationException();
        }

        var caught = await Assert.ThrowsAsync<InvalidOperationException>(Inner);

        Assert.DoesNotContain(HostErrors.Of(caught).Frames, f => f.StartsWith("System.Runtime."));
    }
}
