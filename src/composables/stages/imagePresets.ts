export interface ImagePreset {
  id: string
  icon: string
  category: 'imageVariant' | 'imageEdit' | 'videoChange' | 'audioChange'
  targetClass?: string
  inputSocket?: string
  inputAutogrowGroup?: string
  widgets?: Record<string, unknown>
  multiTargetClasses?: string[]
}

const cat = 'imageVariant' as const

export const IMAGE_VARIANT_PRESETS: ImagePreset[] = [
  { id: 'layer-separation', icon: 'pi pi-clone', category: cat, targetClass: 'ComfyTV.LayerSeparationStage', inputSocket: 'image' },
  { id: 'cinematic-light', icon: 'pi pi-video', category: cat, targetClass: 'ComfyTV.ImageEditStage', inputAutogrowGroup: 'images',
    widgets: {
      main_prompt: 'cinematic key light, dramatic mood, color graded look; relight the image, preserving identity, geometry, and details',
    } },
  { id: 'frame-3s', icon: 'pi pi-clock', category: cat, targetClass: 'ComfyTV.ImageEditStage', inputAutogrowGroup: 'images',
    widgets: {
      main_prompt: 'show the scene 3 seconds later, preserving character, environment, and style; continue the action naturally',
    } },
  { id: 'frame-5s', icon: 'pi pi-clock', category: cat, targetClass: 'ComfyTV.ImageEditStage', inputAutogrowGroup: 'images',
    widgets: {
      main_prompt: 'show the scene 5 seconds later, preserving character, environment, and style; continue the action naturally',
    } },
]
