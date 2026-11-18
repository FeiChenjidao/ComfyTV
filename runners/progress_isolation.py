import threading


_STATE = threading.local()
_INSTALLED = False


def install_progress_isolation() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    try:
        import comfy_execution.progress as progress
        import execution
    except ImportError:
        return

    def get_progress_state():
        registry = getattr(_STATE, "registry", None)
        if registry is None:
            from comfy_execution.graph import DynamicPrompt
            registry = progress.ProgressRegistry("", DynamicPrompt({}))
            _STATE.registry = registry
        return registry

    def reset_progress_state(prompt_id, dynprompt):
        previous = getattr(_STATE, "registry", None)
        if previous is not None:
            previous.reset_handlers()
        _STATE.registry = progress.ProgressRegistry(prompt_id, dynprompt)

    def add_progress_handler(handler):
        registry = get_progress_state()
        handler.set_registry(registry)
        registry.register_handler(handler)

    progress.get_progress_state = get_progress_state
    progress.reset_progress_state = reset_progress_state
    progress.add_progress_handler = add_progress_handler
    execution.get_progress_state = get_progress_state
    execution.reset_progress_state = reset_progress_state
    execution.add_progress_handler = add_progress_handler

    try:
        import comfy_api.latest as comfy_api_latest
        comfy_api_latest.get_progress_state = get_progress_state
    except ImportError:
        pass
    try:
        import main
        main.get_progress_state = get_progress_state
    except ImportError:
        pass
    _INSTALLED = True
