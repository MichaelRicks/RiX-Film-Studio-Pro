"""FORK: the DFR detail pass option on local video generation."""

from __future__ import annotations

from runtime_config.model_download_specs import DFR_DETAIL_LORA_FILENAME, find_dfr_detail_lora

_T2V_JSON = {"prompt": "a test", "resolution": "540p", "model": "fast", "duration": 5, "fps": 24}


def _install_detail_lora(models_dir):
    path = models_dir / "ltx-2.5" / DFR_DETAIL_LORA_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"lora")
    return path


def test_detail_lora_is_only_found_for_ltx_2_5(tmp_path):
    assert find_dfr_detail_lora(tmp_path, "ltx-2.5-22b-distilled") is None
    path = _install_detail_lora(tmp_path)
    assert find_dfr_detail_lora(tmp_path, "ltx-2.5-22b-distilled") == path
    assert find_dfr_detail_lora(tmp_path, "ltx-2.3-22b-distilled-1.1") is None
    assert find_dfr_detail_lora(tmp_path, None) is None


def test_dfr_without_the_lora_is_rejected_before_generating(
    client, test_state, fake_services, create_fake_model_files
):
    create_fake_model_files()
    test_state.state.app_settings.ltx_api_key = "test-key"

    response = client.post("/api/generate", json={**_T2V_JSON, "useDfr": True})

    assert response.status_code == 409
    assert response.json()["code"] == "DFR_NOT_AVAILABLE"
    assert fake_services.fast_video_pipeline.generate_calls == []


def test_dfr_rejects_a_last_frame(client, test_state, fake_services, create_fake_model_files, tmp_path):
    create_fake_model_files()

    response = client.post(
        "/api/generate",
        json={**_T2V_JSON, "imagePath": "/tmp/a.png", "lastImagePath": "/tmp/b.png", "useDfr": True},
    )

    assert response.status_code == 422
    assert fake_services.fast_video_pipeline.generate_calls == []


def test_dfr_toggle_reaches_the_pipeline_only_when_on(
    client, test_state, fake_services, create_fake_model_files
):
    create_fake_model_files()
    test_state.state.app_settings.use_local_text_encoder = True
    test_state.state.app_settings.prompt_enhancer_enabled_t2v = False
    models_dir = test_state.video_generation.models_dir
    before = test_state.video_generation.get_model_specs()
    assert (before.dfr_available, before.dfr_downloadable) == (False, True)
    lora = _install_detail_lora(models_dir)
    after = test_state.video_generation.get_model_specs()
    assert (after.dfr_available, after.dfr_downloadable) == (True, False)

    assert client.post("/api/generate", json={**_T2V_JSON, "useDfr": True}).status_code == 200
    assert client.post("/api/generate", json=_T2V_JSON).status_code == 200

    calls = fake_services.fast_video_pipeline.generate_calls
    assert [call["dfr_lora_path"] for call in calls] == [str(lora), None]


_LORA_CP = "ltx-2.5-dfr-detail-lora"


def test_detail_lora_downloads_into_the_2_5_folder(client, test_state, fake_services, create_fake_model_files):
    create_fake_model_files()
    models_dir = test_state.video_generation.models_dir

    response = client.post("/api/models/download", json={"type": "download", "cp_ids": [_LORA_CP]})

    assert response.status_code == 200
    call = fake_services.model_downloader.calls[-1]
    assert call["repo_id"] == "Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler"
    assert call["filename"] == DFR_DETAIL_LORA_FILENAME  # repo root, no subfolder
    assert call["token"] == "fake-hf-token"
    assert (models_dir / "ltx-2.5" / DFR_DETAIL_LORA_FILENAME).is_file()
    assert test_state.video_generation.get_model_specs().dfr_available is True


def test_detail_lora_needs_hugging_face_sign_in(client, test_state, fake_services, create_fake_model_files):
    from state.app_state_types import HfAuthenticated

    create_fake_model_files()
    test_state.state.hf_auth_state = HfAuthenticated(access_token="expired", expires_at=0)

    response = client.post("/api/models/download", json={"type": "download", "cp_ids": [_LORA_CP]})

    assert response.status_code == 403
    assert fake_services.model_downloader.calls == []


def test_detail_lora_is_described_for_the_download_ui(client):
    response = client.post("/api/models/describe", json={"cp_ids": [_LORA_CP]})
    item = response.json()["checkpoints"][0]
    assert (item["role"], item["downloaded"]) == ("dfr", False)
