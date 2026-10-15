import type { ViewCubeLabels } from '@/app';

// The translated labels of the view cube (spec 11, "Popisky view cube", M17): render knows no
// i18n, so AppShell builds them here and hands them to AppSession.viewSettings.setViewCubeLabels whenever
// the language changes. Pure, so it is tested without vue-i18n.

/** Face labels and arrow names of the view cube from the viewCube.* keys. */
export function viewCubeLabels(t: (key: string) => string): ViewCubeLabels {
  return {
    front: t('viewCube.front'),
    back: t('viewCube.back'),
    left: t('viewCube.left'),
    right: t('viewCube.right'),
    top: t('viewCube.top'),
    bottom: t('viewCube.bottom'),
    turnLeft: t('viewCube.turnLeft'),
    turnRight: t('viewCube.turnRight'),
    turnUp: t('viewCube.turnUp'),
    turnDown: t('viewCube.turnDown'),
    rollClockwise: t('viewCube.rollClockwise'),
    rollCounterClockwise: t('viewCube.rollCounterClockwise'),
    switchToFree: t('viewCube.switchToFree'),
    switchToTurntable: t('viewCube.switchToTurntable'),
  };
}
