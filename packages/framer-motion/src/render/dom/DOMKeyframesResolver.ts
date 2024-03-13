import { isNone } from "../../animation/utils/is-none"
import { getVariableValue } from "./utils/css-variables-conversion"
import { isCSSVariableToken } from "./utils/is-css-variable"
import {
    isNumOrPxType,
    positionalKeys,
    positionalValues,
    removeNonTranslationalTransform,
} from "./utils/unit-conversion"
import { findDimensionValueType } from "./value-types/dimensions"
import {
    KeyframeResolver,
    OnKeyframesResolved,
    UnresolvedKeyframes,
} from "../utils/KeyframesResolver"
import { makeNoneKeyframesAnimatable } from "../html/utils/make-none-animatable"
import { VisualElement } from "../VisualElement"
import { MotionValue } from "../../value"

export class DOMKeyframesResolver<
    T extends string | number
> extends KeyframeResolver<T> {
    name: string
    protected element: VisualElement<HTMLElement | SVGElement>

    private removedTransforms?: [string, string | number][]
    private measuredOrigin?: string | number
    private suspendedScrollY?: number

    constructor(
        unresolvedKeyframes: UnresolvedKeyframes<string | number>,
        onComplete: OnKeyframesResolved<T>,
        name?: string,
        motionValue?: MotionValue<T>
    ) {
        console.log(unresolvedKeyframes, motionValue?.get())
        super(
            unresolvedKeyframes,
            onComplete,
            name,
            motionValue,
            motionValue?.owner as VisualElement,
            true
        )
    }

    readKeyframes() {
        const { unresolvedKeyframes, element, name } = this

        if (!element.current) return

        const noneKeyframeIndexes: number[] = []

        console.log(unresolvedKeyframes)
        super.readKeyframes()
        console.log(1, unresolvedKeyframes)

        /**
         * If any keyframe is a CSS variable, we need to find its value by sampling the element
         */
        for (let i = 0; i < unresolvedKeyframes.length; i++) {
            const keyframe = unresolvedKeyframes[i]
            if (typeof keyframe === "string" && isCSSVariableToken(keyframe)) {
                const resolved = getVariableValue(keyframe, element.current)

                if (resolved !== undefined) {
                    unresolvedKeyframes[i] = resolved as T
                }
            }

            if (isNone(unresolvedKeyframes[i])) {
                noneKeyframeIndexes.push(i)
            }
        }

        console.log(2, unresolvedKeyframes)
        if (noneKeyframeIndexes.length) {
            makeNoneKeyframesAnimatable(
                unresolvedKeyframes,
                noneKeyframeIndexes,
                name
            )
        }
        console.log(3, unresolvedKeyframes)
        /**
         * Check to see if unit type has changed. If so schedule jobs that will
         * temporarily set styles to the destination keyframes.
         * Skip if we have more than two keyframes or this isn't a positional value.
         * TODO: We can throw if there are multiple keyframes and the value type changes.
         */
        if (!positionalKeys.has(name) || unresolvedKeyframes.length !== 2) {
            return
        }

        const [origin, target] = unresolvedKeyframes
        const originType = findDimensionValueType(origin)
        const targetType = findDimensionValueType(target)

        /**
         * Either we don't recognise these value types or we can animate between them.
         */
        if (!originType || !targetType || originType === targetType) return

        /**
         * If both values are numbers or pixels, we can animate between them by
         * converting them to numbers.
         */
        if (isNumOrPxType(originType) && isNumOrPxType(targetType)) {
            for (let i = 0; i < unresolvedKeyframes.length; i++) {
                const value = unresolvedKeyframes[i]
                if (typeof value === "string") {
                    unresolvedKeyframes[i] = parseFloat(value as string)
                }
            }
        } else {
            /**
             * Else, the only way to resolve this is by measuring the element.
             */
            this.needsMeasurement = true
        }
    }

    unsetTransforms() {
        const { element, name, unresolvedKeyframes } = this

        if (!element.current) return

        this.removedTransforms = removeNonTranslationalTransform(element)

        const finalKeyframe =
            unresolvedKeyframes[unresolvedKeyframes.length - 1]

        element.getValue(name, finalKeyframe).jump(finalKeyframe, false)
    }

    measureInitialState() {
        const { element, unresolvedKeyframes, name } = this

        if (!element.current) return

        if (name === "height") {
            this.suspendedScrollY = window.pageYOffset
        }

        this.measuredOrigin = positionalValues[name](
            element.measureViewportBox(),
            window.getComputedStyle(element.current)
        )

        unresolvedKeyframes[0] = this.measuredOrigin
    }

    renderEndStyles() {
        this.element.render()
    }

    measureEndState() {
        const { element, name, unresolvedKeyframes } = this

        if (!element.current) return

        const value = element.getValue(name)
        value && value.jump(this.measuredOrigin, false)

        unresolvedKeyframes[unresolvedKeyframes.length - 1] = positionalValues[
            name
        ](
            element.measureViewportBox(),
            window.getComputedStyle(element.current)
        ) as any

        if (name === "height" && this.suspendedScrollY !== undefined) {
            window.scrollTo(0, this.suspendedScrollY)
        }

        // If we removed transform values, reapply them before the next render
        if (this.removedTransforms?.length) {
            this.removedTransforms.forEach(
                ([unsetTransformName, unsetTransformValue]) => {
                    element
                        .getValue(unsetTransformName)!
                        .set(unsetTransformValue)
                }
            )
        }
    }
}
