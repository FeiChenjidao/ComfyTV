import type { TimelineController } from '@/widgets/three/load3d/TimelineController'

import type { SceneCameraManager } from '../SceneCameraManager'
import type { ShotDirector } from './ShotDirector'

export class TimelineDurationSync {
  animationDuration = 0
  private hadContent = false
  private playIntent = true

  constructor(
    private readonly timelineController: TimelineController,
    private readonly director: ShotDirector,
    private readonly sceneCameraManager: SceneCameraManager
  ) {}

  setPlayIntent(playing: boolean): void {
    this.playIntent = playing
  }

  refresh(): void {
    this.timelineController.setTimelineDuration(
      this.director.shotsDurationSeconds() ??
        Math.max(
          this.animationDuration,
          this.sceneCameraManager.maxPresetDuration()
        )
    )
    const hasContent = this.timelineController.hasContent()
    if (
      hasContent &&
      !this.hadContent &&
      this.playIntent &&
      !this.timelineController.isPlayingNow()
    ) {
      this.timelineController.play()
    }
    this.hadContent = hasContent
  }
}
