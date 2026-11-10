"""Downloads SAM 2.1 (base plus, Apache-2.0, no sign-in) into the runtime's models folder."""

import os
import sys

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from huggingface_hub import snapshot_download  # noqa: E402

MODEL = "facebook/sam2.1-hiera-base-plus"


def main() -> None:
    models = sys.argv[1]
    # transformers reads the safetensors weights and the JSON configs; the repo's .pt and .yaml
    # copies (the same weights for Meta's own package) would only double the download.
    snapshot_download(
        MODEL,
        local_dir=os.path.join(models, "sam2.1-hiera-base-plus"),
        allow_patterns=["*.json", "*.safetensors", "README.md"],
    )
    print(f"{MODEL} ready")


if __name__ == "__main__":
    main()
