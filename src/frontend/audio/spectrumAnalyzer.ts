// Spectrum Analyzer for Audio Frequency Visualization
// Provides real-time frequency spectrum data and visualization utilities

import { AudioAnalyser } from "./audioAnalyser"

export interface SpectrumBar {
    x: number
    width: number
    height: number
    frequency: number
    amplitude: number
}

export class SpectrumAnalyzer {
    private frequencyData: Uint8Array
    private smoothedFrequencyData: Float32Array
    private animationFrame: number | null = null
    private isAnalyzing = false
    private lastUpdateTime = 0
    private readonly updateInterval = 50 // Update every 50ms (20 FPS) for better performance

    // Configuration
    private readonly smoothingFactor = 0.15 // Slightly increased for smoother visualization
    private readonly numBars = 100 // Number of frequency bars to display

    // Frequency range
    private readonly minFreq = 20
    private readonly maxFreq = 20000

    // Dynamic properties based on actual analyser
    private actualFFTSize = 256
    private actualSampleRate = 48000

    // Callbacks
    private onUpdateCallback?: () => void

    constructor() {
        // Start with default size, will be updated based on actual analyser
        this.frequencyData = new Uint8Array(128)
        this.smoothedFrequencyData = new Float32Array(128)
        this.updateAnalyserProperties()
    }

    /**
     * Update properties based on actual analyser configuration
     */
    private updateAnalyserProperties(): void {
        const analysers = AudioAnalyser.getAnalysers()
        if (analysers && analysers.length > 0) {
            const analyser = analysers[0]
            this.actualFFTSize = analyser.fftSize
            this.actualSampleRate = analyser.context.sampleRate

            // Resize arrays if needed based on actual frequency bin count
            const actualBinCount = analyser.frequencyBinCount
            if (this.frequencyData.length !== actualBinCount) {
                this.frequencyData = new Uint8Array(actualBinCount)
                this.smoothedFrequencyData = new Float32Array(actualBinCount)
            }
        }
    }

    /**
     * Start analyzing frequency data
     */
    public start(onUpdate?: () => void): void {
        if (this.isAnalyzing) return

        // Update analyser properties before starting
        this.updateAnalyserProperties()

        this.onUpdateCallback = onUpdate
        this.isAnalyzing = true
        this.updateFrequencyData()
    }

    /**
     * Stop analyzing frequency data
     */
    public stop(): void {
        this.isAnalyzing = false
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame)
            this.animationFrame = null
        }
        this.onUpdateCallback = undefined
    }

    /**
     * Check if analyzer is currently running
     */
    public isRunning(): boolean {
        return this.isAnalyzing
    }

    /**
     * Get current frequency data (smoothed)
     */
    public getFrequencyData(): Float32Array {
        return this.smoothedFrequencyData
    }

    /**
     * Update frequency data from audio analyzers
     */
    private updateFrequencyData(): void {
        if (!this.isAnalyzing) return

        const currentTime = Date.now()

        // Throttle updates for better performance
        if (currentTime - this.lastUpdateTime < this.updateInterval) {
            this.animationFrame = requestAnimationFrame(() => this.updateFrequencyData())
            return
        }

        this.lastUpdateTime = currentTime

        // Get frequency data from AudioAnalyser
        const analysers = AudioAnalyser.getAnalysers()
        if (analysers && analysers.length > 0) {
            // Use first channel (left) for frequency visualization
            const analyser = analysers[0]

            // Create properly typed array and get frequency data
            const tempData = new Uint8Array(analyser.frequencyBinCount)
            analyser.getByteFrequencyData(tempData)

            // Copy to our arrays (ensuring they're the right size)
            if (this.frequencyData.length !== tempData.length) {
                this.frequencyData = new Uint8Array(tempData.length)
                this.smoothedFrequencyData = new Float32Array(tempData.length)
            }

            for (let i = 0; i < tempData.length; i++) {
                this.frequencyData[i] = tempData[i]
            }

            // Apply light smoothing to frequency data (AudioAnalyser already has smoothing)
            for (let i = 0; i < this.frequencyData.length; i++) {
                this.smoothedFrequencyData[i] =
                    this.smoothingFactor * this.frequencyData[i] +
                    (1 - this.smoothingFactor) * this.smoothedFrequencyData[i]
            }

            // Trigger callback for reactive updates
            this.onUpdateCallback?.()
        }

        // Schedule next frame
        this.animationFrame = requestAnimationFrame(() => this.updateFrequencyData())
    }

    /**
     * Convert frequency to bin index (now using actual analyser properties)
     */
    private frequencyToBin(frequency: number): number {
        // Get current analyser for accurate calculation
        const analysers = AudioAnalyser.getAnalysers()
        if (analysers && analysers.length > 0) {
            const analyser = analysers[0]
            const sampleRate = analyser.context.sampleRate
            const fftSize = analyser.fftSize
            return Math.round((frequency * fftSize) / sampleRate)
        }

        // Fallback to stored values
        return Math.round((frequency * this.actualFFTSize) / this.actualSampleRate)
    }

    /**
     * Get frequency amplitude at a specific frequency (interpolated)
     */
    public getFrequencyAmplitude(frequency: number): number {
        const binIndex = this.frequencyToBin(frequency)
        const maxBin = this.smoothedFrequencyData.length - 1

        if (binIndex <= 0) return this.smoothedFrequencyData[0] || 0
        if (binIndex >= maxBin) return this.smoothedFrequencyData[maxBin] || 0

        // Linear interpolation between adjacent bins
        const lowerBin = Math.floor(binIndex)
        const upperBin = Math.ceil(binIndex)
        const fraction = binIndex - lowerBin

        const lowerValue = this.smoothedFrequencyData[lowerBin] || 0
        const upperValue = this.smoothedFrequencyData[upperBin] || 0

        return lowerValue + (upperValue - lowerValue) * fraction
    }

    /**
     * Get averaged frequency amplitude over a frequency range for better resolution
     */
    private getAveragedFrequencyAmplitude(startFreq: number, endFreq: number, frequencyResolution: number, totalBins: number): number {
        // Convert frequency range to bin indices
        const startBinFloat = startFreq / frequencyResolution
        const endBinFloat = endFreq / frequencyResolution

        const startBin = Math.max(0, Math.floor(startBinFloat))
        const endBin = Math.min(totalBins - 1, Math.ceil(endBinFloat))

        if (startBin === endBin) {
            // Single bin case - use interpolation if we're between bins
            if (startBin < totalBins - 1) {
                const fraction = startBinFloat - startBin
                const currentValue = this.smoothedFrequencyData[startBin] || 0
                const nextValue = this.smoothedFrequencyData[startBin + 1] || 0
                return currentValue + (nextValue - currentValue) * fraction
            } else {
                return this.smoothedFrequencyData[startBin] || 0
            }
        }

        let weightedSum = 0
        let totalWeight = 0

        // For frequency ranges spanning multiple bins, use weighted averaging
        for (let bin = startBin; bin <= endBin; bin++) {
            if (bin >= totalBins) break

            const binStartFreq = bin * frequencyResolution
            const binEndFreq = (bin + 1) * frequencyResolution

            // Calculate overlap between this bin and our target frequency range
            const overlapStart = Math.max(startFreq, binStartFreq)
            const overlapEnd = Math.min(endFreq, binEndFreq)
            const overlapAmount = Math.max(0, overlapEnd - overlapStart)

            if (overlapAmount > 0) {
                // Weight based on how much of the bin overlaps with our target range
                const weight = overlapAmount / frequencyResolution
                const binValue = this.smoothedFrequencyData[bin] || 0

                weightedSum += binValue * weight
                totalWeight += weight
            }
        }

        return totalWeight > 0 ? weightedSum / totalWeight : 0
    }

    /**
     * Generate spectrum bars data for visualization - aligned with frequency grid
     */
    public generateSpectrumBars(canvasWidth: number, canvasHeight: number): SpectrumBar[] {
        const bars: SpectrumBar[] = []
        const barWidth = canvasWidth / this.numBars

        // Get current analyser for accurate frequency range
        const analysers = AudioAnalyser.getAnalysers()
        let maxDisplayFreq = this.maxFreq
        let sampleRate = this.actualSampleRate
        let fftSize = this.actualFFTSize

        if (analysers && analysers.length > 0) {
            const analyser = analysers[0]
            sampleRate = analyser.context.sampleRate
            fftSize = analyser.fftSize
            // Limit max frequency to Nyquist frequency (half of sample rate)
            maxDisplayFreq = Math.min(this.maxFreq, sampleRate / 2)
        }

        // Calculate frequency resolution per bin
        const frequencyResolution = sampleRate / fftSize
        const totalBins = this.smoothedFrequencyData.length

        // Use SAME logarithmic frequency distribution as AudioEqualizer component
        // This ensures perfect alignment with the frequency grid
        const logMin = Math.log10(this.minFreq)
        const logMax = Math.log10(maxDisplayFreq)

        for (let i = 0; i < this.numBars; i++) {
            const x = i * barWidth

            // Calculate frequency for this bar using pure logarithmic scale
            // (matching AudioEqualizer's getFreqX/getXFreq functions)
            const logProgress = i / this.numBars
            const logFreq = logMin + logProgress * (logMax - logMin)
            const frequency = Math.pow(10, logFreq)

            // Calculate frequency range for this bar
            const nextLogProgress = (i + 1) / this.numBars
            const nextLogFreq = logMin + nextLogProgress * (logMax - logMin)
            const nextFrequency = i === this.numBars - 1 ? maxDisplayFreq : Math.pow(10, nextLogFreq)

            // Get amplitude by averaging the frequency range for this bar
            const amplitude = this.getAveragedFrequencyAmplitude(frequency, nextFrequency, frequencyResolution, totalBins)
            const normalizedAmplitude = amplitude / 255 // Normalize to 0-1

            // Apply logarithmic scaling for better visual representation
            const logAmplitude = normalizedAmplitude > 0 ? Math.log10(normalizedAmplitude * 9 + 1) : 0
            const height = logAmplitude * canvasHeight * 0.9 // Max 90% of canvas height

            bars.push({
                x,
                width: barWidth - 1, // Small gap between bars
                height: Math.max(0, height), // Ensure non-negative height
                frequency,
                amplitude: normalizedAmplitude
            })
        }

        return bars
    }

    /**
     * Get smooth color for amplitude level
     */
    public static getSpectrumColor(amplitude: number): string {
        // Much smoother color interpolation with more gradual transitions
        if (amplitude <= 0.15) {
            // Very low: bright green
            return `hsl(140, 100%, ${50 + amplitude * 200}%)`
        } else if (amplitude <= 0.35) {
            // Low to medium-low: green to lime green
            const progress = (amplitude - 0.15) / 0.2
            const hue = 140 - progress * 20 // 140 to 120
            return `hsl(${hue}, 100%, 65%)`
        } else if (amplitude <= 0.55) {
            // Medium-low to medium: lime to yellow-green
            const progress = (amplitude - 0.35) / 0.2
            const hue = 120 - progress * 30 // 120 to 90
            return `hsl(${hue}, 100%, 65%)`
        } else if (amplitude <= 0.75) {
            // Medium to medium-high: yellow-green to yellow-orange
            const progress = (amplitude - 0.55) / 0.2
            const hue = 90 - progress * 35 // 90 to 55
            return `hsl(${hue}, 100%, 60%)`
        } else if (amplitude <= 0.9) {
            // Medium-high to high: yellow-orange to orange-red
            const progress = (amplitude - 0.75) / 0.15
            const hue = 55 - progress * 30 // 55 to 25
            return `hsl(${hue}, 100%, 55%)`
        } else {
            // Very high: orange-red to deep red
            const progress = (amplitude - 0.9) / 0.1
            const hue = 25 - progress * 25 // 25 to 0
            return `hsl(${hue}, 100%, 50%)`
        }
    }

    /**
     * Get normalized amplitude at specific frequency (0-1 range)
     */
    public getNormalizedAmplitude(frequency: number): number {
        return this.getFrequencyAmplitude(frequency) / 255
    }

    /**
     * Convert frequency to X position using logarithmic scale (matches AudioEqualizer)
     */
    public frequencyToX(frequency: number, canvasWidth: number): number {
        const logMin = Math.log10(this.minFreq)
        const logMax = Math.log10(this.maxFreq)
        const logFreq = Math.log10(frequency)
        return ((logFreq - logMin) / (logMax - logMin)) * canvasWidth
    }

    /**
     * Convert X position to frequency using logarithmic scale (matches AudioEqualizer)
     */
    public xToFrequency(x: number, canvasWidth: number): number {
        const logMin = Math.log10(this.minFreq)
        const logMax = Math.log10(this.maxFreq)
        const logFreq = logMin + (x / canvasWidth) * (logMax - logMin)
        return Math.pow(10, logFreq)
    }

    /**
     * Cleanup resources
     */
    public dispose(): void {
        this.stop()
        // Clear data arrays
        this.frequencyData.fill(0)
        this.smoothedFrequencyData.fill(0)
    }
}