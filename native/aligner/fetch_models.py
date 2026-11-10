"""Downloads the CTC alignment models for ctc.py at pinned revisions, checking every file's sha256.
Run by setup.sh with the runtime's Python; the aligner itself never touches the network.

    <runtime python> fetch_models.py <runtime>/models

English: facebook/wav2vec2-large-960h-lv60-self (~1.26 GB), whose PyTorch weights are converted
here to safetensors with torch.load(weights_only=True), so nothing in the download can run code.
Japanese: reazon-research/japanese-wav2vec2-base-rs35kh (~0.39 GB).
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "wav2vec2-large-960h-lv60-self": (
        "facebook/wav2vec2-large-960h-lv60-self",
        "54074b1c16f4de6a5ad59affb4caa8f2ea03a119",
        {
            "config.json": "bcb82b508db66c6772b34a978bcc6a411f9ea99c33cd9dee337119b5f6ddb797",
            "preprocessor_config.json": "c403ce09975b90dff0dd8302c42d422e9de1f166cd7772df23490069893cb0cf",
            "feature_extractor_config.json": "5415d0e5f57a6893552b1f916d6e9b9ce312a147fff3e65b260fefadd2f77dbf",
            "special_tokens_map.json": "bb7068de1150661a10b55f9e4b12a0e77af8bf91f5e45e1b58afaf1d0e17f675",
            "tokenizer_config.json": "c9a86ca4c3d72d4cda976512cd786cc65d87fe22afcd4164c8470f1dde7c9758",
            "vocab.json": "19727f8944fe6459fc3f240ae2c198395b740f6a029bd23e06656266b83bcf64",
            "pytorch_model.bin": "00b604cf4d28e86559e8adaeb3a186daa89dc37f5ab216771a0a15a26db0de9f",
        },
    ),
    "reazon-base-rs35kh": (
        "reazon-research/japanese-wav2vec2-base-rs35kh",
        "46afc596052b612293c8db256b3a69447a2f57dc",
        {
            "added_tokens.json": "4de0ae97b4959a8d86c933b0ec9afaf72a917ebf02d1693c1ccba1d34c575599",
            "config.json": "ce1cf984403e369ba3d9757e48850be2e6f3b931f72d54b9b725e5ba5621c6af",
            "preprocessor_config.json": "60ca5a31e13f69ee2fbf147504c8676db5f6398fd7a6b12294341dff838edfcf",
            "special_tokens_map.json": "fe941423230c28a1b96e319effd1cb23982cadf1d27e2a62f6054313b6d3fc3f",
            "tokenizer_config.json": "5ecf666fb5c77cb12d8ee420ae1c7321b4fc28d0f377baaff0d135529aad6822",
            "vocab.json": "223300c979885b08b6a44f18b6b76cae49099c6de1a0bc2d5694a32827b3a7ab",
            "model.safetensors": "f7e05abd4c9f98e7d311ab0c4904dac8cdde49290f6ac015e96d40e02df0312f",
        },
    ),
}


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            result.update(chunk)
    return result.hexdigest()


def fetch(repo, revision, name, target, expected):
    if target.exists() and digest(target) == expected:
        return
    url = f"https://huggingface.co/{repo}/resolve/{revision}/{name}"
    partial = target.with_name(target.name + ".partial")
    with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as out:
        for chunk in iter(lambda: response.read(1 << 20), b""):
            out.write(chunk)
    if digest(partial) != expected:
        partial.unlink()
        raise SystemExit(f"{repo}/{name}: checksum mismatch, download discarded")
    partial.replace(target)


def to_safetensors(source, target):
    import torch
    from safetensors.torch import save_file

    state = torch.load(source, map_location="cpu", weights_only=True)
    if not isinstance(state, dict) or not all(isinstance(v, torch.Tensor) for v in state.values()):
        raise SystemExit(f"{source}: not a plain tensor file")
    save_file({k: v.contiguous().clone() for k, v in state.items()}, str(target), metadata={"format": "pt"})


def main(models_dir):
    for folder, (repo, revision, files) in MODELS.items():
        directory = models_dir / folder
        directory.mkdir(parents=True, exist_ok=True)
        if (directory / "model.safetensors").exists() and all(
            (directory / name).exists() for name in files if name != "pytorch_model.bin"
        ):
            print(f"{folder}: already installed")
            continue
        for name, expected in files.items():
            print(f"{folder}: {name}", flush=True)
            fetch(repo, revision, name, directory / name, expected)
        if (directory / "pytorch_model.bin").exists():
            to_safetensors(directory / "pytorch_model.bin", directory / "model.safetensors")
            (directory / "pytorch_model.bin").unlink()


if __name__ == "__main__":
    main(Path(sys.argv[1]))
