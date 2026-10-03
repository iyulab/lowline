using System.Text.Json;
using System.Text.Json.Nodes;

namespace Lowline.Host.Tests;

public sealed class SuggestionsTests
{
    private static readonly TemplateSnapshot Intake = new("intake@1",
    [
        new TemplateField("요청", "textarea"),
        new TemplateField("부서", "text"),
        new TemplateField("담당", "select"),
    ], Suggest: ["담당"]);

    private static IReadOnlyDictionary<string, JsonElement> Values(string json) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

    private static DocumentSnapshot Document(string path, string json) => new(path, "intake@1", Values(json));

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task<VaultProjection> Vault(params DocumentSnapshot[] documents)
    {
        var vault = new VaultProjection();
        await vault.IngestAsync(new VaultSnapshot([Intake], documents), Ct);
        return vault;
    }

    /// <summary>
    /// Thirty requests, no two alike, where 부서 decides 담당 — the history a field's values settled alongside need
    /// before replay lets them answer.
    /// </summary>
    private static DocumentSnapshot[] Decided() =>
    [
        .. Enumerable.Range(0, 30).Select(i => new DocumentSnapshot($"문서/{i}.md", "intake@1",
            Values($$"""{"요청": "{{Words[i % 10]}} {{Words[i / 10 * 3 % 10]}} {{i}}", "부서": "{{Departments[i % 3]}}", "담당": "{{Owners[Departments[i % 3]]}}"}"""),
            Modified: i)),
    ];

    private static readonly string[] Words = ["사과", "기차", "구름", "연필", "바다", "시계", "우산", "나무", "모자", "종이"];
    private static readonly Dictionary<string, string> Owners = new() { ["영업"] = "장비", ["개발"] = "인사", ["인사"] = "총무" };
    private static readonly string[] Departments = [.. Owners.Keys];

    private static async Task<VaultProjection> Selected(VaultSnapshot snapshot)
    {
        var vault = new VaultProjection();
        await vault.IngestAsync(snapshot, Ct);
        await vault.ThresholdsSelected.WaitAsync(Ct);
        return vault;
    }

    [Fact]
    public async Task Does_not_offer_the_value_a_similar_document_confirmed()
    {
        // The request is nearly 문서/1's, but its 부서 settles nothing: a similar document's value is not a promise.
        await using var vault = await Selected(new VaultSnapshot([Intake], Decided()));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "기차 사과 1!", "부서": "기획"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.Undecided), suggestion);
        Assert.True(vault.MemoryReady);
    }

    [Fact]
    public async Task Does_not_offer_a_value_only_another_fields_value_backs()
    {
        // 인사 was confirmed with 부서 개발, but the request itself resembles nothing confirmed.
        await using var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
            Document("문서/2.md", """{"요청": "급여 명세서를 다시 받고 싶어요", "부서": "개발", "담당": "인사"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다", "부서": "개발"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.BelowTarget), suggestion);
    }

    [Fact]
    public async Task Does_not_offer_a_value_nothing_in_the_document_backs()
    {
        // 장비 is the field's most frequent value, but nothing in this document points to it.
        await using var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업", "담당": "장비"}"""),
            Document("문서/2.md", """{"요청": "모니터가 깜빡여요", "부서": "영업", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "회의실 예약 방법이 궁금합니다", "부서": "총무"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.BelowTarget), suggestion);
    }

    [Fact]
    public async Task A_document_is_not_its_own_similar_document()
    {
        await using var vault = await Vault(Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요!"}"""), "문서/1.md"), Ct);

        Assert.Null(suggestion!.Value);
    }

    [Fact]
    public async Task Does_not_learn_from_a_document_with_a_conflict_copy()
    {
        // A sync client kept both devices' edits: which values hold is not settled yet.
        await using var vault = await Vault(
            Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}""") with { Conflicted = true });

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요!"}""")), Ct);
        var table = await vault.TableAsync("intake@1", Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.NoHistory), suggestion);
        Assert.Equal("문서/1.md", Assert.Single(table!.Rows).Path);
    }

    [Fact]
    public async Task Abstains_until_the_history_shows_what_decides_the_field()
    {
        // The same request confirmed once: too little to show its value is right often enough.
        await using var vault = await Vault(Document("문서/1.md", """{"요청": "노트북 배터리가 금방 닳아요", "담당": "장비"}"""));

        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.BelowTarget), suggestion);
    }

    [Fact]
    public async Task Abstains_on_an_empty_document_and_with_an_empty_memory()
    {
        await using var empty = await Vault();
        var none = await empty.SuggestAsync(new SuggestRequest("intake@1", "담당", Values("""{"요청": "무엇이든"}""")), Ct);
        Assert.Null(none!.Value);

        await using var vault = await Vault(Document("문서/1.md", """{"요청": "배터리", "담당": "장비"}"""));
        var blank = await vault.SuggestAsync(new SuggestRequest("intake@1", "담당", Values("{}")), Ct);
        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.BelowTarget), blank);

        await using var decided = await Selected(new VaultSnapshot([Intake], Decided()));
        var nothing = await decided.SuggestAsync(new SuggestRequest("intake@1", "담당", Values("{}")), Ct);
        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.Undecided), nothing);
    }

    [Fact]
    public async Task Offers_nothing_for_a_field_the_author_did_not_turn_suggestions_on_for()
    {
        await using var vault = await Vault(Document("문서/1.md", """{"요청": "배터리", "부서": "영업", "담당": "장비"}"""));
        Assert.Null(await vault.SuggestAsync(new SuggestRequest("intake@1", "부서", Values("""{"요청": "배터리"}""")), Ct));
        Assert.Null(await vault.SuggestAsync(new SuggestRequest("other@1", "담당", Values("{}")), Ct));
    }

    [Fact]
    public async Task Chooses_a_fields_threshold_from_its_history_once_it_is_long_enough()
    {
        var few = await Suggestions.BuildAsync(new VaultSnapshot([Intake],
            [.. Enumerable.Range(1, 5).Select(i => Document($"문서/{i}.md", $$"""{"요청": "노트북 배터리 문제 {{i}}", "담당": "장비"}"""))]), Ct);
        Assert.Null(few.Choice("intake@1", "담당")); // too short: nothing is offered yet

        var many = await Suggestions.BuildAsync(Many(15), Ct);
        Assert.True(many.NeedsSelection);
        Assert.Null(many.Choice("intake@1", "담당")); // chosen apart from building memory
        many.Apply(many.SelectThresholds(Ct));
        Assert.False(many.NeedsSelection);
        var choice = many.Choice("intake@1", "담당");
        Assert.NotNull(choice);
        Assert.True(choice.Precision >= Suggestions.TargetPrecision);
        Assert.True(choice.Answered >= Suggestions.MinimumAnswered);

        // Rebuilt from the same vault, the field keeps its threshold rather than replaying again.
        var rebuilt = await Suggestions.BuildAsync(Many(15), Ct, kept: many.Thresholds);
        Assert.False(rebuilt.NeedsSelection);
        Assert.Equal(choice, rebuilt.Choice("intake@1", "담당"));
        Assert.True((await Suggestions.BuildAsync(Many(17), Ct, kept: many.Thresholds)).NeedsSelection); // grew by a tenth
    }

    [Fact]
    public async Task A_field_naming_another_document_decides_a_judgment_field_by_that_documents_id()
    {
        // 고객 names a customer document by its id; which customer it is decides 담당.
        var inquiry = new TemplateSnapshot("inquiry@1",
        [
            new TemplateField("요청", "textarea"),
            new TemplateField("고객", "select"),
            new TemplateField("담당", "select"),
        ], Suggest: ["담당"]);
        string[] words = ["사과", "기차", "구름", "연필", "바다", "시계", "우산", "나무", "모자", "종이"];
        var owners = new Dictionary<string, string>
        {
            ["3f2a1b2c-0000-4000-8000-000000000001"] = "장비",
            ["3f2a1b2c-0000-4000-8000-000000000002"] = "인사",
            ["3f2a1b2c-0000-4000-8000-000000000003"] = "총무",
        };
        var customers = owners.Keys.ToArray();
        var vault = new VaultSnapshot([inquiry],
            [.. Enumerable.Range(0, 30).Select(i => new DocumentSnapshot($"문서/{i}.md", "inquiry@1",
                Values($$"""{"요청": "{{words[i % 10]}} {{words[i / 10 * 3 % 10]}} {{i}}", "고객": "{{customers[i % 3]}}", "담당": "{{owners[customers[i % 3]]}}"}"""),
                Modified: i))]);
        var suggestions = await Suggestions.BuildAsync(vault, Ct);
        suggestions.Apply(suggestions.SelectThresholds(Ct));

        var request = new SuggestRequest("inquiry@1", "담당", Values($$"""{"요청": "전혀 다른 요청", "고객": "{{customers[1]}}"}"""));
        Assert.Equal(new Suggestion("인사", "key", $"고객: {customers[1]}"), await suggestions.SuggestAsync(request, Ct));
    }

    [Fact]
    public async Task Answers_from_a_field_that_decides_it_once_its_history_shows_it_does()
    {
        // 부서 decides 담당 here, while no two requests are alike.
        var suggestions = await Suggestions.BuildAsync(new VaultSnapshot([Intake], Decided()), Ct);
        var request = new SuggestRequest("intake@1", "담당", Values("""{"요청": "전혀 다른 요청", "부서": "개발"}"""));

        // Until replay shows 부서 decides it, a value settled alongside it is only a guess.
        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.BelowTarget), await suggestions.SuggestAsync(request, Ct));

        suggestions.Apply(suggestions.SelectThresholds(Ct));
        Assert.Equal(new Suggestion("인사", "key", "부서: 개발"), await suggestions.SuggestAsync(request, Ct));
    }

    [Fact]
    public async Task Says_a_field_its_replay_held_back_apart_from_one_these_values_settle_nothing_for()
    {
        // One 부서, owners alternating: the value last settled alongside it is never the next one's.
        var vault = new VaultSnapshot([Intake],
            [.. Enumerable.Range(1, 15).Select(i => new DocumentSnapshot($"문서/{i}.md", "intake@1",
                Values($$"""{"요청": "노트북 배터리 문제 {{i}}", "부서": "영업", "담당": "{{(i % 2 == 0 ? "장비" : "인사")}}"}"""), Modified: i))]);
        var suggestions = await Suggestions.BuildAsync(vault, Ct);
        Assert.Equal(NoReplay.Pending, suggestions.WhyNoReplay("intake@1", "담당"));

        suggestions.Apply(suggestions.SelectThresholds(Ct));
        Assert.Null(suggestions.Choice("intake@1", "담당"));
        Assert.Equal(Abstention.BelowTarget, suggestions.WhyNoReplay("intake@1", "담당"));
        var suggestion = await suggestions.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리 문제 16", "부서": "영업"}""")), Ct);
        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.BelowTarget), suggestion);
        // How close it came: the latest value settled alongside 영업 was the wrong one every time.
        var closest = suggestions.Closest("intake@1", "담당");
        Assert.NotNull(closest);
        Assert.True(closest.Precision < Suggestions.TargetPrecision, $"{closest}");
    }

    [Fact]
    public async Task Says_why_a_field_has_no_replay_yet()
    {
        var empty = await Suggestions.BuildAsync(new VaultSnapshot([Intake], []), Ct);
        Assert.Equal(NoReplay.Few, empty.WhyNoReplay("intake@1", "담당"));

        var few = await Suggestions.BuildAsync(Many(5), Ct);
        few.Apply(few.SelectThresholds(Ct));
        Assert.Equal(NoReplay.Few, few.WhyNoReplay("intake@1", "담당"));

        var many = await Suggestions.BuildAsync(Many(15), Ct);
        Assert.Equal(NoReplay.Pending, many.WhyNoReplay("intake@1", "담당"));
        many.Apply(many.SelectThresholds(Ct));
        Assert.Null(many.WhyNoReplay("intake@1", "담당"));
        Assert.Null(many.WhyNoReplay("intake@1", "부서")); // not a judgment field
    }

    private static VaultSnapshot Many(int count) => new([Intake],
        [.. Enumerable.Range(1, count).Select(i => new DocumentSnapshot($"문서/{i}.md", "intake@1",
            Values($$"""{"요청": "노트북 배터리 문제 {{i}}", "부서": "영업", "담당": "장비"}"""), Modified: i))]);

    [Fact]
    public async Task A_vault_ingest_chooses_thresholds_in_the_background()
    {
        await using var vault = new VaultProjection();
        await vault.IngestAsync(Many(15), Ct);
        await vault.ThresholdsSelected.WaitAsync(Ct);
        await vault.IngestAsync(Many(15), Ct);
        Assert.True(vault.ThresholdsSelected.IsCompleted); // nothing grew: no replay started
    }

    [Fact]
    public async Task A_later_launch_starts_from_the_thresholds_the_last_one_chose()
    {
        var caches = Directory.CreateTempSubdirectory("lowline-thresholds-").FullName;
        try
        {
            await using (var first = new VaultProjection(caches))
            {
                await first.IngestAsync(Many(15), "C:/vault", Ct);
                await first.ThresholdsSelected.WaitAsync(Ct);
            }
            await using var later = new VaultProjection(caches);
            await later.IngestAsync(Many(15), "C:/vault", Ct);
            // Nothing grew since: the field answers at the strength its history earned, with no replay to wait for.
            Assert.True(later.ThresholdsSelected.IsCompleted);
            var kept = ThresholdStore.Load(later.ThresholdsFileOf("C:/vault"))[("intake@1", "담당")];
            Assert.Equal(15, kept.SelectedAt);
            Assert.NotNull(kept.Choice);

            // Another vault opened next, with a template of the same name, has its own history: its fields
            // are replayed, not handed the first vault's thresholds.
            var settled = later.ThresholdsSelected;
            await later.IngestAsync(Many(15), "C:/other", Ct);
            Assert.NotSame(settled, later.ThresholdsSelected);
            await later.ThresholdsSelected.WaitAsync(Ct);
        }
        finally
        {
            Directory.Delete(caches, recursive: true);
        }
    }

    [Fact]
    public void A_kept_thresholds_file_that_cannot_be_read_is_no_thresholds()
    {
        var file = Path.GetTempFileName();
        try
        {
            File.WriteAllText(file, "{ not json");
            Assert.Empty(ThresholdStore.Load(file));
            File.WriteAllText(file, """{"format": 99, "fields": []}""");
            Assert.Empty(ThresholdStore.Load(file));
            Assert.Empty(ThresholdStore.Load(file + ".missing"));
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task Thresholds_another_Gil_chose_are_chosen_again()
    {
        var caches = Directory.CreateTempSubdirectory("lowline-thresholds-").FullName;
        try
        {
            string file;
            await using (var first = new VaultProjection(caches))
            {
                await first.IngestAsync(Many(15), "C:/vault", Ct);
                await first.ThresholdsSelected.WaitAsync(Ct);
                file = first.ThresholdsFileOf("C:/vault");
            }
            string? ScorerIn() => JsonNode.Parse(File.ReadAllText(file))!["scorer"]?.GetValue<string>();
            Assert.NotEmpty(ThresholdStore.Load(file));
            Assert.Equal(ThresholdStore.Scorer, ScorerIn());

            // The same file as an earlier Gil wrote it — its thresholds on that Gil's scale — and as one
            // written before the file said which Gil chose them.
            void Rewrite(Action<JsonObject> change)
            {
                var kept = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
                change(kept);
                File.WriteAllText(file, kept.ToJsonString());
            }
            Rewrite(kept => kept["scorer"] = "0.8.0");
            Assert.Empty(ThresholdStore.Load(file));
            Rewrite(kept => kept.Remove("scorer"));
            Assert.Empty(ThresholdStore.Load(file));

            await using var later = new VaultProjection(caches);
            await later.IngestAsync(Many(15), "C:/vault", Ct);
            // Nothing grew, yet the field is replayed — what was kept is not on this Gil's scale — and its
            // threshold kept again, now as this Gil's.
            await later.ThresholdsSelected.WaitAsync(Ct);
            Assert.Equal(ThresholdStore.Scorer, ScorerIn());
            Assert.NotEmpty(ThresholdStore.Load(file));
        }
        finally
        {
            Directory.Delete(caches, recursive: true);
        }
    }

    [Fact]
    public async Task Asking_teaches_nothing()
    {
        // Only saved documents teach. A request carrying a value for the judgment field — an unsaved
        // draft that already holds one — must not become something later requests are answered from.
        await using var vault = await Selected(new VaultSnapshot([Intake], Decided()));
        await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "사내 동호회 가입 신청서 양식", "부서": "기획", "담당": "총무"}"""), "문서/new.md"), Ct);

        var later = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "사내 동호회 가입 신청서 양식", "부서": "기획"}""")), Ct);

        Assert.Equal(new Suggestion(null, "abstain", null, Abstention.Undecided), later);
    }

    // 문서/0, 3, 6 … are 영업's, confirmed with 장비.
    private static readonly DocumentSnapshot[] Confirmed = Decided();

    private static SuggestionEvent Event(string at, string doc, string kind) => new(at, doc, "담당", kind, "장비");

    private static async Task<string?> SuggestedIn(VaultProjection vault, string document)
    {
        var suggestion = await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요", "부서": "영업"}"""), document), Ct);
        return suggestion!.Value;
    }

    [Fact]
    public async Task Does_not_offer_again_what_was_rejected_in_a_document()
    {
        await using var vault = await Selected(new VaultSnapshot([Intake], Confirmed, [Event("2026-09-28T10:00:00.000Z", "문서/2.md", "reject")]));

        Assert.Null(await SuggestedIn(vault, "문서/2.md"));
        Assert.Equal("장비", await SuggestedIn(vault, "문서/3.md"));
        Assert.Equal("rejected", (await vault.SuggestAsync(
            new SuggestRequest("intake@1", "담당", Values("""{"요청": "노트북 배터리가 금방 닳아요"}"""), "문서/2.md"), Ct))!.Mode);
    }

    [Fact]
    public async Task A_later_confirmation_in_the_document_lifts_a_rejection()
    {
        await using var vault = await Selected(new VaultSnapshot([Intake], Confirmed,
        [
            Event("2026-09-28T11:00:00.000Z", "문서/2.md", "correct"),
            Event("2026-09-28T10:00:00.000Z", "문서/2.md", "reject"),
        ]));

        Assert.Equal("장비", await SuggestedIn(vault, "문서/2.md"));
    }

    [Fact]
    public async Task A_document_is_known_by_its_id_wherever_its_file_is()
    {
        // The rejection was recorded when the file was 문서/2.md; it has been renamed since.
        var renamed = Confirmed.Select(d => d.Path == "문서/2.md" ? d with { Path = "문서/새 이름.md", Id = "doc-2" } : d).ToArray();
        await using var vault = await Selected(new VaultSnapshot([Intake], renamed, [Event("2026-09-28T10:00:00.000Z", "doc-2", "reject")]));

        Assert.Null(await SuggestedIn(vault, "doc-2"));
        Assert.Equal("장비", await SuggestedIn(vault, "doc-9"));
    }

    [Fact]
    public async Task A_value_that_backs_another_about_one_time_in_three_does_not_answer_for_it()
    {
        // Support requests written from a few stock sentences, so settled documents repeat one another and
        // answer each other right by their own requests. 채널 전화 leans to 배송 but backs it only about a third of
        // the time, and 제품 backs nothing: neither may answer 분류 for a request unlike any settled one, however
        // well the repeats did on the replay.
        var support = new TemplateSnapshot("support@1",
        [
            new TemplateField("문의", "textarea"),
            new TemplateField("채널", "select"),
            new TemplateField("제품", "select"),
            new TemplateField("분류", "select"),
        ], Suggest: ["분류"]);
        var sentences = new Dictionary<string, string[]>
        {
            ["고장"] = ["정수기에서 물이 새요", "전원이 들어오지 않아요", "소음이 심해졌어요"],
            ["배송"] = ["주문한 제품이 아직 안 왔어요", "배송 조회가 안 돼요", "다른 주소로 받고 싶어요"],
            ["환불"] = ["환불 받고 싶어요", "결제가 두 번 됐어요", "반품 접수는 어떻게 하나요"],
            ["설치"] = ["설치 기사 방문 일정을 잡고 싶어요", "벽걸이로 달 수 있나요", "이사 후 재설치 문의"],
        };
        var kinds = sentences.Keys.ToArray();
        string[] products = ["정수기", "공기청정기", "비데"];
        var random = new Random(586);
        var vault = new VaultSnapshot([support],
            [.. Enumerable.Range(0, 200).Select(i =>
            {
                var kind = kinds[random.Next(kinds.Length)];
                var phone = random.NextDouble() < (kind == "배송" ? 0.6 : 0.25);
                var channel = phone ? "전화" : random.Next(2) == 0 ? "채팅" : "이메일";
                var json = $$"""{"문의": "{{sentences[kind][random.Next(3)]}}", "채널": "{{channel}}", "제품": "{{products[random.Next(3)]}}", "분류": "{{kind}}"}""";
                return new DocumentSnapshot($"문서/{i:D3}.md", "support@1", Values(json), Modified: i);
            })]);
        var byPhone = vault.Documents.Where(d => d.Values["채널"].GetString() == "전화").ToList();
        var deliveryShare = (double)byPhone.Count(d => d.Values["분류"].GetString() == "배송") / byPhone.Count;
        Assert.InRange(deliveryShare, 0.25, 0.45); // the lean the case is about, measured on the data itself
        Assert.Equal("배송", byPhone.GroupBy(d => d.Values["분류"].GetString()).MaxBy(g => g.Count())!.Key);

        var suggestions = await Suggestions.BuildAsync(vault, Ct);
        suggestions.Apply(suggestions.SelectThresholds(Ct));

        var suggestion = await suggestions.SuggestAsync(new SuggestRequest("support@1", "분류",
            Values("""{"문의": "정수기에서 물이 조금씩 흘러나와요", "채널": "전화", "제품": "정수기"}""")), Ct);
        Assert.NotNull(suggestion);
        Assert.NotEqual("key", suggestion.Mode);
        Assert.NotEqual("배송", suggestion.Value);
    }
}
