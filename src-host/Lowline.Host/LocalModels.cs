using IronProw.Core;
using IronProw.LMSupply;
using LMSupply;
using LMSupply.Exceptions;
using LMSupply.Generator;
using LMSupply.Generator.Abstractions;
using LMSupply.Generator.Gguf;
using LMSupply.Llama.Server;
using Microsoft.Extensions.AI;

namespace Lowline.Host;

/// <summary>A model Lowline can run on this computer: its LMSupply alias, its name, how much it takes to get, and whether it is here.</summary>
public sealed record LocalModel(string Id, string Name, long SizeBytes, bool Downloaded, bool Recommended);

/// <summary>Where getting a model ready on this computer stands.</summary>
public static class LocalPhase
{
    /// <summary>No model was asked for since the sidecar started.</summary>
    public const string Idle = "idle";

    /// <summary>Fetching what is not here — <see cref="LocalModelProgress.Getting"/> says what.</summary>
    public const string Getting = "getting";

    /// <summary>Starting the model's server and loading the model.</summary>
    public const string Starting = "starting";

    /// <summary>Running: the chat answers on it.</summary>
    public const string Ready = "ready";

    /// <summary>It did not get ready — <see cref="LocalModelProgress.Failure"/> says why.</summary>
    public const string Failed = "failed";
}

/// <summary>What is being fetched while a model gets ready.</summary>
public static class LocalGetting
{
    /// <summary>The model's file.</summary>
    public const string Model = "model";

    /// <summary>The program that runs it (llama.cpp's server).</summary>
    public const string Runtime = "runtime";
}

/// <summary>
/// Where getting a model ready on this computer stands: one of <see cref="LocalPhase"/>'s; while getting, what
/// (<see cref="LocalGetting"/>) and <see cref="Received"/> of <see cref="Total"/> bytes; when failed, why (one of
/// <see cref="ModelFailure"/>'s).
/// </summary>
public sealed record LocalModelProgress(string? Model, string Phase, string? Getting = null, long? Received = null, long? Total = null, string? Failure = null)
{
    public static readonly LocalModelProgress Idle = new(null, LocalPhase.Idle);
}

/// <summary>The models offered on this computer, and where getting one ready stands.</summary>
public sealed record LocalModelsView(IReadOnlyList<LocalModel> Models, LocalModelProgress Progress);

/// <summary>What the shell asks to get ready: one of the models offered.</summary>
public sealed record LocalModelPick(string Model);

/// <summary>What runs a model on this computer — LMSupply in the app, a stand-in in tests.</summary>
public interface ILocalGenerators
{
    bool IsDownloaded(string model);

    /// <summary>
    /// Loads <paramref name="model"/>, fetching what is missing only when <paramref name="mayFetch"/> — the person
    /// asked for it — and otherwise failing with <see cref="ModelNotFoundException"/>.
    /// </summary>
    Task<ITextGenerator> LoadAsync(string model, bool mayFetch, IProgress<DownloadProgress> progress, CancellationToken cancellationToken);

    /// <summary>Lets go of servers no model uses any more.</summary>
    Task ReleaseIdleAsync();
}

/// <summary>
/// LMSupply's GGUF models. Its llama.cpp server is fetched from llama.cpp's releases the first time a model is got
/// ready, and never again on its own: no background version checks or updates.
/// </summary>
public sealed class LmSupplyGenerators : ILocalGenerators
{
    public bool IsDownloaded(string model) => LocalGenerator.IsModelDownloaded(model);

    public async Task<ITextGenerator> LoadAsync(string model, bool mayFetch, IProgress<DownloadProgress> progress, CancellationToken cancellationToken) =>
        await LocalGenerator.LoadAsync(model, new GeneratorOptions
        {
            DisableAutoDownload = !mayFetch,
            ServerUpdateOptions = new LlamaServerUpdateOptions { AutoDownloadUpdates = false },
        }, progress, cancellationToken);

    public Task ReleaseIdleAsync() => LlamaServerPool.Instance.ReleaseIdleAsync();
}

/// <summary>
/// The model running on this computer for the chat: one at a time, loaded when the person gets it ready — fetching
/// it then if it is not here — or, after a restart, on the first chat from what is already here, never fetching.
/// </summary>
public sealed class LocalModels(ILocalGenerators generators) : IAsyncDisposable
{
    /// <summary>
    /// The models offered, the recommended first: 4B or more (smaller ones, measured, seldom wrote a template that
    /// parsed), without a known instruction-following problem, and small enough for an office PC.
    /// </summary>
    public static readonly IReadOnlyList<string> Offered = ["gguf:qwen3-default", "gguf:qwen3-balanced"];

    /// <summary>A reply is long enough for a whole template of a few dozen fields.</summary>
    public const int MaxOutputTokens = 2048;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Lock _progressLock = new();
    private LocalModelProgress _progress = LocalModelProgress.Idle;
    private ITextGenerator? _generator;
    private Task? _preparing;

    public LocalModelsView View()
    {
        var models = Offered.Select((id, i) =>
        {
            var info = GgufModelRegistry.Resolve(id)!;
            return new LocalModel(id, info.DisplayName, info.EstimatedSizeBytes ?? 0, generators.IsDownloaded(id), Recommended: i == 0);
        }).ToList();
        lock (_progressLock) return new LocalModelsView(models, _progress);
    }

    /// <summary>Starts getting <paramref name="model"/> ready — fetching what is missing — unless it already is or is on its way.</summary>
    public LocalModelProgress Prepare(string model)
    {
        if (!Offered.Contains(model)) return new LocalModelProgress(model, LocalPhase.Failed, Failure: ModelFailure.Invalid);
        lock (_progressLock)
        {
            if (_progress.Model == model && _progress.Phase is LocalPhase.Getting or LocalPhase.Starting or LocalPhase.Ready) return _progress;
            _progress = new LocalModelProgress(model, LocalPhase.Starting);
            _preparing = Task.Run(() => LoadAsync(model, mayFetch: true, CancellationToken.None));
            return _progress;
        }
    }

    /// <summary>
    /// The chat on <paramref name="model"/>, loading it from what is here when it is not running; null with why when
    /// it cannot run.
    /// </summary>
    public async Task<(IChatClient? Chat, string? Failure)> ChatAsync(string model, CancellationToken cancellationToken)
    {
        if (!Offered.Contains(model)) return (null, ModelFailure.Invalid);
        if (_preparing is { } preparing) await preparing.WaitAsync(cancellationToken);
        var (generator, failure) = await LoadAsync(model, mayFetch: false, cancellationToken);
        if (generator is null) return (null, failure);
        var ready = new LazyReadinessProbe(() => true, [generator.ModelId]);
        return (LMSupplyExtensions.BuildLocalSafeClient(generator, ready, new LocalSafetyOptions { DefaultMaxOutputTokens = MaxOutputTokens }), null);
    }

    /// <summary>Makes <paramref name="model"/> the one running, unless it is: the model running, or why it is not.</summary>
    private async Task<(ITextGenerator? Generator, string? Failure)> LoadAsync(string model, bool mayFetch, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_generator is not null && Running == model)
            {
                Report(new LocalModelProgress(model, LocalPhase.Ready));
                return (_generator, null);
            }
            await UnloadAsync();
            Report(new LocalModelProgress(model, LocalPhase.Starting));
            var progress = new Progress<DownloadProgress>(p => Report(new LocalModelProgress(model, LocalPhase.Getting,
                Getting: p.Kind == DownloadKind.Runtime ? LocalGetting.Runtime : LocalGetting.Model,
                Received: p.OverallBytesDownloaded ?? p.BytesDownloaded,
                Total: p.OverallTotalBytes ?? p.TotalBytes)));
            try
            {
                _generator = await generators.LoadAsync(model, mayFetch, progress, cancellationToken);
                Running = model;
                Report(new LocalModelProgress(model, LocalPhase.Ready));
                return (_generator, null);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                Report(LocalModelProgress.Idle);
                throw;
            }
            catch (Exception e)
            {
                var failure = Failure(e);
                Report(new LocalModelProgress(model, LocalPhase.Failed, Failure: failure));
                return (null, failure);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Which model <see cref="_generator"/> runs, by the alias it was loaded with.</summary>
    private string? Running { get; set; }

    /// <summary>Why a model did not get ready: not here and not to be fetched now, nothing to fetch it from, or it would not start.</summary>
    public static string Failure(Exception e)
    {
        for (var inner = e; inner is not null; inner = inner.InnerException)
        {
            if (inner is ModelNotFoundException) return ModelFailure.NotDownloaded;
            if (inner is HttpRequestException or System.Net.Sockets.SocketException) return ModelFailure.Unreachable;
        }
        return ModelFailure.NotStarted;
    }

    private void Report(LocalModelProgress progress)
    {
        lock (_progressLock)
        {
            // A late progress report of a fetch does not overwrite the end it reached.
            if (progress.Phase == LocalPhase.Getting && _progress.Model == progress.Model && _progress.Phase is LocalPhase.Ready or LocalPhase.Failed) return;
            _progress = progress;
        }
    }

    private async Task UnloadAsync()
    {
        if (_generator is null) return;
        await _generator.DisposeAsync();
        _generator = null;
        Running = null;
        await generators.ReleaseIdleAsync();
    }

    public async ValueTask DisposeAsync()
    {
        await _gate.WaitAsync();
        try
        {
            await UnloadAsync();
        }
        finally
        {
            _gate.Release();
        }
    }
}
