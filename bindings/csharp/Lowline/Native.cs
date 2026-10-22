using System.Runtime.InteropServices;
using System.Text;

namespace Lowline;

/// <summary>The C ABI of the native library (crate <c>lowline-ffi</c>), one declaration per exported function.</summary>
internal static unsafe partial class Native
{
    private const string Library = "lowline_native";

    internal const int Ok = 0;
    internal const int InvalidInput = 1;
    internal const int InvalidArgument = 2;
    internal const int Panic = 3;
    internal const int Broken = 5;

    internal const byte SettledByPerson = 0;
    internal const byte SettledByApplication = 1;

    /// <summary>The version of the C ABI this binding was built for (<c>LOWLINE_ABI_VERSION</c>).</summary>
    internal const uint AbiVersion = 2;

    private static volatile bool _compatible;

    [StructLayout(LayoutKind.Sequential)]
    internal struct Str
    {
        public byte* Ptr;
        public nuint Len;
    }

    [LibraryImport(Library, EntryPoint = "lowline_abi_version")]
    private static partial uint LibraryAbiVersion();

    [LibraryImport(Library, EntryPoint = "lowline_last_error")]
    private static partial nuint LastError(byte* buffer, nuint capacity);

    [LibraryImport(Library, EntryPoint = "lowline_last_result")]
    private static partial nuint LastResult(byte* buffer, nuint capacity);

    [LibraryImport(Library, EntryPoint = "lowline_engine_new")]
    internal static partial int EngineNew(Str definition, nint* engine);

    [LibraryImport(Library, EntryPoint = "lowline_engine_free")]
    internal static partial void EngineFree(nint engine);

    [LibraryImport(Library, EntryPoint = "lowline_engine_settled")]
    internal static partial nuint EngineSettled(nint engine);

    [LibraryImport(Library, EntryPoint = "lowline_engine_learn")]
    internal static partial int EngineLearn(nint engine, Str records);

    [LibraryImport(Library, EntryPoint = "lowline_engine_restore")]
    internal static partial int EngineRestore(nint engine, Str tuning);

    [LibraryImport(Library, EntryPoint = "lowline_engine_stale")]
    internal static partial int EngineStale(nint engine, nuint* resultLen);

    [LibraryImport(Library, EntryPoint = "lowline_engine_tune")]
    internal static partial int EngineTune(nint engine, Str records, nuint* resultLen);

    [LibraryImport(Library, EntryPoint = "lowline_engine_choose")]
    internal static partial int EngineChoose(nint engine, Str records, nuint* resultLen);

    [LibraryImport(Library, EntryPoint = "lowline_engine_propose")]
    internal static partial int EnginePropose(nint engine, Str id, Str values, Str allowed, nuint* resultLen);

    [LibraryImport(Library, EntryPoint = "lowline_engine_propose_field")]
    internal static partial int EngineProposeField(
        nint engine, Str id, Str values, Str allowed, Str field, Str typed, nuint* resultLen);

    [LibraryImport(Library, EntryPoint = "lowline_engine_describe")]
    internal static partial int EngineDescribe(nint engine, Str values, Str allowed, nuint* resultLen);

    [LibraryImport(Library, EntryPoint = "lowline_engine_fill")]
    internal static partial int EngineFill(nint engine, Str values, Str allowed, Str answered, nuint* resultLen);

    [LibraryImport(Library, EntryPoint = "lowline_engine_offer")]
    internal static partial int EngineOffer(
        nint engine, Str id, Str values, Str allowed, Str field, Str ranked, nuint* resultLen);

    [LibraryImport(Library, EntryPoint = "lowline_engine_settle")]
    internal static partial int EngineSettle(
        nint engine, Str id, Str saved, Str draft, byte by, long settledAt, nuint* resultLen);

    /// <summary>Makes sure the native library speaks the interface this binding was built for — once, before the first
    /// call.</summary>
    /// <exception cref="InvalidOperationException">The library speaks another version.</exception>
    /// <exception cref="DllNotFoundException">No library for the running platform was found.</exception>
    internal static void EnsureCompatible()
    {
        if (_compatible)
        {
            return;
        }

        uint found;
        try
        {
            found = LibraryAbiVersion();
        }
        catch (DllNotFoundException e)
        {
            throw NotFound(e);
        }

        if (found != AbiVersion)
        {
            throw new InvalidOperationException(
                $"The native library {Library} speaks version {found} of its interface; this binding needs version " +
                $"{AbiVersion}. Use the native library built with this binding.");
        }

        _compatible = true;
    }

    /// <summary>The library was not found: says which platform asked and how to build it.</summary>
    internal static DllNotFoundException NotFound(DllNotFoundException inner) =>
        new($"The native library {Library} was not found for {RuntimeInformation.RuntimeIdentifier}. Build it from " +
            "the repository (cargo build --release -p lowline-ffi) and put it next to the application.", inner);

    /// <summary>Throws for a refused call, with the native message: a refused input is the caller's
    /// <see cref="ArgumentException"/>; a broken engine is <see cref="LowlineBrokenException"/>; anything else is a
    /// defect of the binding or the library.</summary>
    internal static void Check(int status)
    {
        if (status == Ok)
        {
            return;
        }

        var message = Copy(&LastError);
        throw status switch
        {
            InvalidInput => new ArgumentException(message),
            Broken => new LowlineBrokenException(message),
            _ => new InvalidOperationException($"The engine refused a call from its binding ({status}): {message}"),
        };
    }

    /// <summary>The text result of the last call on this thread.</summary>
    internal static string Result(nuint length) => length == 0 ? string.Empty : Copy(&LastResult);

    private static string Copy(delegate*<byte*, nuint, nuint> copy)
    {
        var length = copy(null, 0);
        if (length == 0)
        {
            return string.Empty;
        }

        var buffer = new byte[(int)length];
        fixed (byte* p = buffer)
        {
            copy(p, length);
        }

        return Encoding.UTF8.GetString(buffer);
    }
}

/// <summary>Text encoded once as UTF-8 for one call; pin it with <c>fixed</c> and pass <see cref="Native.Str"/>.</summary>
internal readonly ref struct Utf8
{
    public Utf8(string? text) => Bytes = text is null ? [] : Encoding.UTF8.GetBytes(text);

    public byte[] Bytes { get; }

    public unsafe Native.Str At(byte* pinned) => new() { Ptr = pinned, Len = (nuint)Bytes.Length };
}
